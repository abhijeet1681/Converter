// ConvertHub server
// - Serves the website with strict security headers (needed by FFmpeg WebAssembly)
// - SEO: real URLs per tool (/tools/jpg-to-png) with unique <title>/description, sitemap.xml, robots.txt
// - Optional server-side Office conversion (Word/PowerPoint/Excel -> PDF etc.) via LibreOffice
import express from 'express';
import compression from 'compression';
import multer from 'multer';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
// The tool catalog is shared between browser and server (single source of truth).
// Static import (not a dynamic path) so serverless bundlers (Vercel/nft) trace and include it.
import { TOOLS, CATEGORIES, SITE_NAME } from './public/js/tools.js';
import { loadEnvFile } from './src/env.js';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const pkg = createRequire(import.meta.url)('./package.json');

loadEnvFile(path.join(__dirname, '.env'));

// Serverless (Vercel / Lambda / Netlify): there is no persistent disk, no LibreOffice, no rclone, and
// "127.0.0.1" means the function itself — never the owner's laptop. So, regardless of what environment
// variables were pasted into the dashboard:
//   • Office conversion is always OFF (physically impossible there)
//   • file archive is ON only with the Google Drive API login (GDRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN) — files are
//     staged in /tmp and uploaded to Drive inside the request; with rclone-only settings it is OFF
//   • MySQL / Ollama / Whisper pointing at localhost are treated as OFF (avoids 5 s connect timeouts per cold start)
//   • a real cloud MySQL (DB_HOST=db.example.com / DATABASE_URL) or remote Ollama URL still works
// The 115+ in-browser tools work exactly the same; the UI shows friendly "not available" notices for the rest.
const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
if (SERVERLESS) {
  const isLocal = v => !v || /^(https?:\/\/)?(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)(:\d+)?\/?$/i.test(String(v).trim());
  const driveApi = process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET && process.env.GDRIVE_REFRESH_TOKEN && process.env.GDRIVE_ENABLED !== 'false';
  if (driveApi) process.env.GDRIVE_ENABLED = 'true'; else process.env.ARCHIVE_FILES = 'false';
  process.env.ENABLE_OFFICE_CONVERSION = 'false';
  if (isLocal(process.env.DB_HOST) && !process.env.DATABASE_URL) process.env.DB_ENABLED = 'false';
  if (isLocal(process.env.OLLAMA_URL)) process.env.OLLAMA_URL = '';
  if (isLocal(process.env.WHISPER_URL)) process.env.WHISPER_URL = '';
  process.env.TRUST_PROXY = 'true'; // always behind the platform's proxy
}

// DB + AI modules read process.env, so import them only after .env is loaded
const db = await import('./src/db.js');
const ai = await import('./src/ai.js');
const archive = await import('./src/archive.js');

const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  siteUrl: (process.env.SITE_URL || '').replace(/\/+$/, ''),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 100,
  enableOffice: process.env.ENABLE_OFFICE_CONVERSION !== 'false',
  officeTimeoutMs: (Number(process.env.OFFICE_TIMEOUT_SECONDS) || 180) * 1000,
  maxConcurrent: Number(process.env.MAX_CONCURRENT_JOBS) || 2,
  rateLimitPerHour: Number(process.env.RATE_LIMIT_PER_HOUR) || 60,
  trustProxy: process.env.TRUST_PROXY === 'true',
  adminKey: process.env.ADMIN_KEY || '',
  aiRateLimitPerHour: Number(process.env.AI_RATE_LIMIT_PER_HOUR) || 40,
};

const TOOL_MAP = new Map(TOOLS.map(t => [t.id, t]));
const CAT_MAP = new Map(CATEGORIES.map(c => [c.id, c]));

const OFFICE_INPUT = new Set(['doc', 'docx', 'odt', 'rtf', 'txt', 'wpd', 'ppt', 'pptx', 'pps', 'ppsx', 'odp', 'xls', 'xlsx', 'ods', 'csv']);
const OFFICE_OUTPUT = new Set(['pdf', 'docx', 'odt', 'rtf', 'pptx', 'odp', 'xlsx', 'ods']);
const MIME = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

const soffice = config.enableOffice ? await findSoffice() : null;
let activeJobs = 0;
const dbReady = await db.initDb();
const aiStatus = await ai.aiHealth(true);
// Never let the archive take the whole site down (e.g. unwritable ARCHIVE_DIR) — degrade to "archive off"
const archiveOn = await archive.initArchive().catch(e => { console.warn(`  ➜ Archive: DISABLED — ${e.message}`); return false; });
if (archiveOn) {
  archive.setDriveCallback((fileId, info) => db.setDriveInfo(fileId, info));
  if (dbReady) archive.resumePending(await db.pendingDriveUploads()); // finish uploads interrupted by a restart / Drive being offline
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy ? 1 : false);
app.use(compression());
app.use('/api', express.json({ limit: '2mb' }));
// Anonymous visitor id — a random UUID the browser sends in a header. Never contains personal data.
app.use('/api', (req, res, next) => { req.sid = String(req.get('x-ch-session') || ''); next(); });

// ---------- Security headers ----------
// COOP/COEP = "cross-origin isolation" (lets FFmpeg WebAssembly use fast memory features).
// 'unsafe-eval' / 'wasm-unsafe-eval' are required by the WebAssembly libraries (FFmpeg, HEIC decoder).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ---------- HTML pages with per-page SEO ----------
// The HTML shell lives in src/ (not public/) because it is a TEMPLATE with __TITLE__ placeholders, never served raw.
const template = fs.readFileSync(path.join(__dirname, 'src', 'template.html'), 'utf8');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseUrl = req => config.siteUrl || `${req.protocol}://${req.get('host')}`;

function sendPage(req, res, { title, description, pathName, status = 200 }) {
  const html = template
    .replaceAll('__TITLE__', esc(title))
    .replaceAll('__DESCRIPTION__', esc(description))
    .replaceAll('__CANONICAL__', esc(baseUrl(req) + pathName));
  res.status(status).set('Cache-Control', 'no-cache').type('html').send(html);
}

const HOME = {
  title: `${SITE_NAME} — Free All-in-One File Converter (Image, PDF, Video, Audio, Excel)`,
  description: `Convert images, PDFs, Word, Excel, audio and video for free with ${TOOLS.length}+ tools. Private by design: most files never leave your device. No sign-up, no watermark.`,
};

app.get('/', (req, res) => sendPage(req, res, { ...HOME, pathName: '/' }));
app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.get('/tools/:id', (req, res) => {
  const t = TOOL_MAP.get(req.params.id);
  if (!t) return sendPage(req, res, { title: `Tool not found — ${SITE_NAME}`, description: HOME.description, pathName: req.path, status: 404 });
  sendPage(req, res, { title: `${t.title} — Free Online Tool | ${SITE_NAME}`, description: t.desc, pathName: `/tools/${t.id}` });
});
app.get('/category/:id', (req, res) => {
  const c = CAT_MAP.get(req.params.id);
  if (!c) return sendPage(req, res, { title: `Not found — ${SITE_NAME}`, description: HOME.description, pathName: req.path, status: 404 });
  sendPage(req, res, { title: `${c.name} Converters & Tools — ${SITE_NAME}`, description: c.desc, pathName: `/category/${c.id}` });
});
app.get('/privacy', (req, res) => sendPage(req, res, { title: `Privacy Policy — ${SITE_NAME}`, description: `How ${SITE_NAME} protects your files.`, pathName: '/privacy' }));
app.get('/about', (req, res) => sendPage(req, res, { title: `About — ${SITE_NAME}`, description: `About ${SITE_NAME}, the private all-in-one converter.`, pathName: '/about' }));
app.get('/history', (req, res) => sendPage(req, res, { title: `My Conversions — ${SITE_NAME}`, description: 'Your recent conversions on this device.', pathName: '/history' }));
app.get('/admin', (req, res) => sendPage(req, res, { title: `Admin Dashboard — ${SITE_NAME}`, description: 'Usage analytics.', pathName: '/admin' }));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /history\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  const b = baseUrl(req);
  const urls = ['/', '/about', '/privacy', ...CATEGORIES.map(c => `/category/${c.id}`), ...TOOLS.map(t => `/tools/${t.id}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${esc(b + u)}</loc><changefreq>weekly</changefreq><priority>${u === '/' ? '1.0' : u.startsWith('/tools') ? '0.8' : '0.6'}</priority></url>`).join('\n') +
    `\n</urlset>\n`;
  res.type('application/xml').send(xml);
});

// ---------- API ----------
app.get('/api/health', async (req, res) => {
  const a = await ai.aiHealth();
  res.json({
    ok: true, name: SITE_NAME, version: pkg.version, office: Boolean(soffice), maxUploadMb: config.maxUploadMb,
    db: db.dbStatus().ready, ai: { llm: a.llm, model: a.model, whisper: a.whisper },
    archive: archiveOn ? { enabled: true, keepDays: archive.archiveConfig().keepDays, maxFileMb: archive.archiveConfig().maxFileMb, drive: archive.archiveConfig().drive.enabled, backend: archive.archiveConfig().drive.backend } : { enabled: false },
  });
});

// ---------- Tracking API (anonymous usage analytics → MySQL) ----------
// Every handler is "best effort": if the DB is down we still answer 200 so the UI never breaks.
const ok = (res, extra) => res.json({ ok: true, ...extra });
app.post('/api/track/session', async (req, res) => {
  await db.upsertSession(req.sid, req.body || {}, req.ip, req.get('user-agent'));
  ok(res);
});
app.post('/api/track/view', async (req, res) => { await db.upsertSession(req.sid, {}, req.ip, req.get('user-agent')); await db.insertPageView(req.sid, req.body || {}); ok(res); });
app.post('/api/track/search', async (req, res) => { await db.insertSearch(req.sid, req.body || {}); ok(res); });
app.post('/api/track/event', async (req, res) => { await db.insertEvent(req.sid, req.body || {}); ok(res); });
app.post('/api/track/download', async (req, res) => { await db.insertDownload(req.sid, req.body || {}); ok(res); });
app.post('/api/track/error', async (req, res) => { await db.insertError(req.sid, { ...(req.body || {}), source: 'browser' }); ok(res); });
app.post('/api/track/conversion/start', async (req, res) => {
  await db.upsertSession(req.sid, {}, req.ip, req.get('user-agent'));
  const r = await db.startConversion(req.sid, req.body || {});
  ok(res, { id: r?.id || null, public_id: r?.public_id || null });
});
app.post('/api/track/conversion/finish', async (req, res) => { await db.finishConversion(req.sid, req.body?.id, req.body || {}); ok(res); });
app.post('/api/feedback', async (req, res) => {
  const b = req.body || {};
  if (!b.rating && !String(b.comment || '').trim()) return res.status(400).json({ error: 'Please give a rating or write a comment.' });
  await db.insertFeedback(req.sid, b);
  ok(res);
});
app.get('/api/stats', async (req, res) => { res.set('Cache-Control', 'public, max-age=30'); res.json(await db.publicStats()); });
app.get('/api/activity', async (req, res) => { res.set('Cache-Control', 'public, max-age=20'); res.json(await db.recentActivity()); });

// Admin dashboard data — protected by ADMIN_KEY from .env (sent as ?key= or x-admin-key header)
app.get('/api/admin/summary', async (req, res) => {
  const key = String(req.get('x-admin-key') || req.query.key || '');
  if (!config.adminKey) return res.status(503).json({ error: 'Set ADMIN_KEY in .env to enable the dashboard.' });
  if (key.length !== config.adminKey.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.adminKey))) return res.status(401).json({ error: 'Wrong admin key.' });
  if (!db.dbStatus().ready) return res.status(503).json({ error: 'Database not connected.', db: db.dbStatus() });
  const summary = await db.adminSummary(req.query.days);
  summary.archive = archiveOn ? { ...archive.archiveStatus(), drive: { ...(await archive.checkDrive()), enabled: archive.archiveConfig().drive.enabled, remote: archive.archiveConfig().drive.remote, folder: archive.archiveConfig().drive.folder, queue: archive.archiveStatus().drive.queue }, disk: await archive.diskUsage(), totals: await db.archiveTotals() } : { enabled: false };
  res.json(summary);
});

// Admin: download an archived file (local copy; falls back to the Google Drive link)
const adminOk = req => { const key = String(req.get('x-admin-key') || req.query.key || ''); return config.adminKey && key.length === config.adminKey.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.adminKey)); };
app.get('/api/admin/file/:id', async (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  const f = await db.getFile(req.params.id);
  if (!f) return res.status(404).json({ error: 'File not found in database.' });
  if (f.storage_path) {
    try { const abs = archive.absPath(f.storage_path); if (fs.existsSync(abs)) return res.download(abs, f.name); } catch { /* fall through */ }
  }
  if (f.drive_url) return res.redirect(f.drive_url);
  res.status(410).json({ error: 'This file is no longer archived (expired or archive was off when it was converted).' });
});

// ---------- AI API (local Ollama + Whisper; see src/ai.js) ----------
const aiLimiter = rateLimit(60 * 60 * 1000, config.aiRateLimitPerHour);
const aiError = (res, e) => {
  const map = { NO_LLM: 503, NO_WHISPER: 503, EMPTY: 400, BAD_TASK: 400 };
  const status = map[e.code] || (e.name === 'TimeoutError' ? 504 : 500);
  res.status(status).json({ error: e.name === 'TimeoutError' ? 'The AI took too long. Try a smaller file.' : e.message, code: e.code || 'AI_ERROR' });
};
app.get('/api/ai/health', async (req, res) => res.json(await ai.aiHealth()));

// Natural-language tool finder: "photo ko chhota karna hai" → compress-image
app.post('/api/ai/find-tool', aiLimiter, async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Type what you want to do.' });
  try {
    const r = await ai.findTool(query, TOOLS);
    db.insertAiRequest(req.sid, { feature: 'find-tool', model: r.model, input_chars: query.length, output_chars: r.reply.length, duration_ms: r.duration_ms });
    db.insertSearch(req.sid, { query, source: 'ai', results: r.tools.length, picked_tool: r.tools[0] || null });
    res.json({ tools: r.tools.map(id => TOOL_MAP.get(id)).filter(Boolean).map(t => ({ id: t.id, title: t.title, desc: t.desc, cat: t.cat })), reply: r.reply, model: r.model });
  } catch (e) {
    db.insertAiRequest(req.sid, { feature: 'find-tool', input_chars: query.length, status: 'error', error_message: e.message });
    aiError(res, e);
  }
});

// Text intelligence: the browser extracts the text (PDF/DOCX/TXT) and sends ONLY the text
app.post('/api/ai/text', aiLimiter, async (req, res) => {
  const { task, text, targetLang, instruction, length, conversion_id } = req.body || {};
  const chars = String(text || '').length;
  try {
    const r = await ai.runTextTask(task, text, { targetLang, instruction, length });
    db.insertAiRequest(req.sid, { conversion_id, feature: task, model: r.model, input_chars: r.input_chars, output_chars: r.result.length, target_lang: targetLang, duration_ms: r.duration_ms });
    res.json({ result: r.result, model: r.model, chunks: r.chunks, truncated: r.truncated, duration_ms: r.duration_ms });
  } catch (e) {
    db.insertAiRequest(req.sid, { conversion_id, feature: ai.TEXT_TASKS.includes(task) ? task : 'custom', input_chars: chars, target_lang: targetLang, status: 'error', error_message: e.message });
    aiError(res, e);
  }
});

const limiter = rateLimit(60 * 60 * 1000, config.rateLimitPerHour);
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => cb(null, `converthub-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 5 },
});

// Speech → text / subtitles (audio or video file → Whisper). The file is deleted right after.
app.post('/api/ai/transcribe', aiLimiter, (req, res, next) => {
  upload.single('file')(req, res, err => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? `File is too large (max ${config.maxUploadMb} MB).` : `Upload failed: ${err.message}` });
  });
}, async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded.' });
  const { format = 'txt', language = '', task = 'transcribe', conversion_id } = req.body || {};
  try {
    const r = await ai.transcribe(file.path, file.originalname, { format, language, task });
    db.insertAiRequest(req.sid, { conversion_id, feature: 'transcribe', provider: 'whisper', model: 'whisper', input_bytes: file.size, output_chars: r.text.length, target_lang: language || null, duration_ms: r.duration_ms });
    res.json({ text: r.text, format: r.format, duration_ms: r.duration_ms });
  } catch (e) {
    db.insertAiRequest(req.sid, { conversion_id, feature: 'transcribe', provider: 'whisper', input_bytes: file.size, status: 'error', error_message: e.message });
    aiError(res, e);
  } finally { await safeUnlink(file.path); }
});

// Archive: browser sends input/output copies after a conversion (only when ARCHIVE_FILES=true)
const archiveUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir(), filename: (req, file, cb) => cb(null, `converthub-archive-${Date.now()}-${Math.random().toString(36).slice(2)}`) }),
  limits: { fileSize: (archiveOn ? archive.archiveConfig().maxFileMb : 1) * 1024 * 1024, files: 1, fields: 8 },
});
app.post('/api/archive', (req, res, next) => {
  if (!archiveOn) return res.status(404).json({ error: 'Archive is disabled.' });
  archiveUpload.single('file')(req, res, err => {
    if (!err) return next();
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'too large for archive' : err.message });
  });
}, async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file.' });
  const { conversion_id, role, batch } = req.body || {};
  try {
    // Folder key: the MySQL conversion id when analytics are on, otherwise the browser's random batch id
    // (so the archive still works on a deployment without a database — e.g. Vercel + Drive only).
    const hasConv = /^\d{1,12}$/.test(String(conversion_id || ''));
    const key = hasConv ? String(Number(conversion_id)) : /^[A-Za-z0-9-]{8,64}$/.test(String(batch || '')) ? batch : null;
    if (!key) throw new Error('conversion_id or batch missing');
    const name = file.originalname || 'file';
    const rel = await archive.saveLocal(file.path, { conversionId: key, role, name });
    const id = hasConv ? await db.attachArchive(req.sid, { conversion_id, role, name, ext: path.extname(name).slice(1), mime: file.mimetype, size: file.size, storage_path: rel }) : null;
    const drive = await archive.enqueueDrive(id, rel); // server: queued → null; serverless: uploaded now → { id, url }
    res.json({ ok: true, file_id: id, drive_url: drive?.url || null });
  } catch (e) {
    await safeUnlink(file.path);
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/convert/office', limiter, (req, res, next) => {
  if (!config.enableOffice) return res.status(503).json({ error: 'Server-side Office conversion is disabled on this website.', code: 'DISABLED' });
  if (!soffice) return res.status(503).json({ error: 'LibreOffice is not installed on the server. See README → "Enable Office conversions".', code: 'NO_OFFICE' });
  if (activeJobs >= config.maxConcurrent) return res.status(429).json({ error: 'The server is busy. Please try again in a moment.', code: 'BUSY' });
  upload.single('file')(req, res, err => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? `File is too large (max ${config.maxUploadMb} MB).` : `Upload failed: ${err.message}` });
  });
}, convertOffice);

async function convertOffice(req, res) {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded.' });
  const ext = path.extname(file.originalname || '').slice(1).toLowerCase();
  const to = String(req.body?.to || 'pdf').toLowerCase();
  if (!OFFICE_INPUT.has(ext) || !OFFICE_OUTPUT.has(to)) {
    await safeUnlink(file.path);
    return res.status(400).json({ error: `Unsupported conversion: .${ext} → .${to}` });
  }
  activeJobs++;
  let work;
  try {
    work = await fsp.mkdtemp(path.join(os.tmpdir(), 'converthub-'));
    const input = path.join(work, `input.${ext}`);
    await fsp.copyFile(file.path, input);
    await safeUnlink(file.path);
    // A private LibreOffice profile per job allows safe parallel conversions
    const profile = pathToFileURL(path.join(work, 'lo-profile')).href;
    await execFileP(soffice, [
      `-env:UserInstallation=${profile}`, '--headless', '--invisible', '--nodefault', '--nologo',
      '--nolockcheck', '--norestore', '--convert-to', to, '--outdir', work, input,
    ], { timeout: config.officeTimeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    const output = path.join(work, `input.${to}`);
    if (!fs.existsSync(output)) throw new Error('LibreOffice produced no output');
    const original = path.basename(file.originalname, path.extname(file.originalname)) || 'converted';
    res.attachment(`${original}.${to}`);
    res.type(MIME[to] || 'application/octet-stream');
    await new Promise((resolve, reject) => res.sendFile(output, err => (err ? reject(err) : resolve())));
  } catch (e) {
    console.error('[office]', e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: e.killed ? 'Conversion timed out. Try a smaller file.' : 'Conversion failed. The file may be damaged, password-protected or unsupported.' });
    }
  } finally {
    activeJobs--;
    await safeUnlink(file.path);
    if (work) fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Static files ----------
app.use(express.static(PUBLIC_DIR, {
  index: false,
  setHeaders(res, file) {
    if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
    const rel = path.relative(PUBLIC_DIR, file);
    res.setHeader('Cache-Control', rel.startsWith('vendor') ? 'public, max-age=2592000' : 'public, max-age=300');
  },
}));

// ---------- 404 + errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => {
  if (req.method === 'GET' && !path.extname(req.path) && req.accepts('html')) {
    return sendPage(req, res, { title: `Page not found — ${SITE_NAME}`, description: HOME.description, pathName: req.path, status: 404 });
  }
  res.status(404).type('text/plain').send('Not found');
});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  db.insertError(req.sid, { source: 'server', message: err.message, stack: err.stack, url: req.originalUrl });
  res.status(500).json({ error: 'Internal server error' });
});

// ---------- Start ----------
if (!SERVERLESS) checkVendor(); // in a serverless bundle the vendor files live on the CDN, not next to the function
sweepTemp();
setInterval(sweepTemp, 60 * 60 * 1000).unref();
if (archiveOn) { archive.sweep(db.clearExpiredArchive); setInterval(() => archive.sweep(db.clearExpiredArchive), 24 * 60 * 60 * 1000).unref(); }

export default app; // used by the serverless adapter (api/index.js on Vercel)

const server = SERVERLESS ? null : app.listen(config.port, config.host, () => {
  const line = '─'.repeat(52);
  console.log(`\n${line}\n  ${SITE_NAME} v${pkg.version} is running`);
  console.log(`  ➜ Local:   http://localhost:${config.port}`);
  console.log(`  ➜ Tools:   ${TOOLS.length}`);
  console.log(`  ➜ Office:  ${soffice ? 'enabled (' + soffice + ')' : 'not available — Word/PPT→PDF will use fallbacks (see README)'}`);
  console.log(`  ➜ MySQL:   ${dbReady ? 'recording to "' + db.dbStatus().database + '" on ' + db.dbStatus().host + ' ✓' : 'off — nothing is recorded' + (db.dbStatus().error ? ' (' + db.dbStatus().error + ')' : '')}`);
  console.log(`  ➜ AI:      ${aiStatus.llm ? 'Ollama ✓ (' + aiStatus.model + ')' : 'Ollama ✗'} · ${aiStatus.whisper ? 'Whisper ✓' : 'Whisper ✗'}`);
  console.log(`  ➜ Admin:   ${config.adminKey ? 'http://localhost:' + config.port + '/admin' : 'set ADMIN_KEY in .env to enable /admin'}`);
  if (archiveOn) {
    const a = archive.archiveStatus();
    console.log(`  ➜ Archive: ON → ${a.dir} (keep ${a.keepDays || '∞'} days, max ${a.maxFileMb} MB/file)`);
    const where = a.drive.backend === 'api' ? `Drive API as ${a.drive.account || 'your Google account'} → ${a.drive.folderUrl || a.drive.folder}` : `rclone ${a.drive.remote}:${a.drive.folder}`;
    console.log(`  ➜ Drive:   ${!a.drive.enabled ? 'off (GDRIVE_ENABLED=false)' : a.drive.ok ? 'connected ✓ → ' + where : '✗ ' + a.drive.error}`);
  } else console.log('  ➜ Archive: off (ARCHIVE_FILES=false) — files are never stored');
  console.log(`${line}\n`);
  if (aiStatus.llm) ai.warmUp(); // background: load the model now so the first AI request is fast
});
if (server) {
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error(`\nPort ${config.port} is already in use. Change PORT in .env or stop the other program.\n`);
    else console.error(e);
    process.exit(1);
  });
  const shutdown = () => { server.close(async () => { await db.closeDb(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ---------- helpers ----------
async function findSoffice() {
  const win = process.platform === 'win32';
  const candidates = [
    process.env.SOFFICE_PATH,
    win && 'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    win && 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    process.platform === 'darwin' && '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/opt/homebrew/bin/soffice', '/snap/bin/libreoffice',
    'soffice', 'libreoffice',
  ].filter(Boolean);
  for (const c of candidates) {
    if (path.isAbsolute(c)) { if (fs.existsSync(c)) return c; continue; }
    try { await execFileP(c, ['--version'], { timeout: 15000, windowsHide: true }); return c; } catch { /* try next */ }
  }
  return null;
}

function rateLimit(windowMs, max) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: 'Too many conversions. Please try again later.', code: 'RATE_LIMIT' });
    next();
  };
}

async function safeUnlink(p) { if (p) await fsp.unlink(p).catch(() => {}); }

async function sweepTemp() {
  try {
    const dir = os.tmpdir();
    for (const name of await fsp.readdir(dir)) {
      if (!name.startsWith('converthub-')) continue;
      const full = path.join(dir, name);
      const st = await fsp.stat(full).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 60 * 60 * 1000) await fsp.rm(full, { recursive: true, force: true }).catch(() => {});
    }
  } catch { /* ignore */ }
}

function checkVendor() {
  const need = ['ffmpeg/ffmpeg.js', 'ffmpeg-core/ffmpeg-core.wasm', 'pdfjs/pdf.min.js', 'pdf-lib/pdf-lib.min.js', 'xlsx/xlsx.full.min.js'];
  const missing = need.filter(f => !fs.existsSync(path.join(PUBLIC_DIR, 'vendor', f)));
  if (missing.length) console.warn(`\n⚠  Browser libraries missing in public/vendor (${missing.join(', ')}).\n   Run "npm install" (or "npm run vendor").\n`);
}
