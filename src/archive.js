// ConvertHub file archive — OPT-IN copy of every input/output file (ARCHIVE_FILES=true)
// 1. The browser uploads input + output to /api/archive right after a conversion finishes.
// 2. We save it on local disk first (ARCHIVE_DIR/YYYY/MM/DD/<conversion-id>/<role>-<name>) — fast and reliable.
// 3. A background queue uploads it to the owner's Google Drive folder via rclone (GDRIVE_* settings).
// 4. A daily sweeper deletes local + Drive copies older than ARCHIVE_KEEP_DAYS (0 = keep forever).
// When ARCHIVE_FILES=false (default) nothing in this file does anything — the site keeps its "no upload" promise.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cfg = {
  enabled: process.env.ARCHIVE_FILES === 'true',
  dir: path.resolve(ROOT, process.env.ARCHIVE_DIR || 'archive'),
  keepDays: Number(process.env.ARCHIVE_KEEP_DAYS ?? 30),
  maxFileMb: Number(process.env.ARCHIVE_MAX_FILE_MB) || 50,
  drive: {
    enabled: process.env.GDRIVE_ENABLED === 'true',
    remote: process.env.GDRIVE_REMOTE || 'gdrive',
    folder: (process.env.GDRIVE_FOLDER || 'ConvertHub').replace(/^\/+|\/+$/g, ''),
    folderId: process.env.GDRIVE_FOLDER_ID || '',
    rclone: process.env.RCLONE_PATH || '',
  },
};

// ---------- rclone discovery ----------
async function findRclone() {
  const c = [cfg.drive.rclone, 'rclone'];
  if (process.platform === 'win32') {
    const pk = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    try { for (const d of await fsp.readdir(pk)) if (d.startsWith('Rclone.')) for (const sub of await fsp.readdir(path.join(pk, d))) c.push(path.join(pk, d, sub, 'rclone.exe')); } catch { /* no winget dir */ }
    c.push(path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'rclone.exe'), 'C:\\rclone\\rclone.exe');
  }
  for (const p of c.filter(Boolean)) {
    try { await execFileP(p, ['version'], { timeout: 10000, windowsHide: true }); return p; } catch { /* next */ }
  }
  return null;
}

let rclone = null;
let driveState = { configured: false, ok: false, error: null, checkedAt: 0, folderUrl: cfg.drive.folderId ? `https://drive.google.com/drive/folders/${cfg.drive.folderId}` : null };
const rc = (args, timeout = 120000) => execFileP(rclone, args, { timeout, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });

/** Is the Drive remote authorised and reachable? Cached 60 s. */
export async function checkDrive(force = false) {
  if (!cfg.enabled || !cfg.drive.enabled) return driveState;
  if (!force && Date.now() - driveState.checkedAt < 60000) return driveState;
  const next = { ...driveState, checkedAt: Date.now() };
  try {
    rclone ||= await findRclone();
    if (!rclone) throw new Error('rclone is not installed (winget install Rclone.Rclone)');
    const { stdout } = await rc(['listremotes'], 15000);
    next.configured = stdout.split(/\r?\n/).includes(`${cfg.drive.remote}:`);
    if (!next.configured) throw new Error(`rclone remote "${cfg.drive.remote}" is not set up yet — run the one-time login command (see README → Google Drive archive)`);
    await rc(['lsd', `${cfg.drive.remote}:`, '--max-depth', '1'], 30000);
    next.ok = true; next.error = null;
  } catch (e) {
    next.ok = false; next.error = String(e.stderr || e.message).split('\n')[0].slice(0, 300);
  }
  driveState = next;
  return driveState;
}

export function archiveStatus() {
  return { enabled: cfg.enabled, dir: cfg.dir, keepDays: cfg.keepDays, maxFileMb: cfg.maxFileMb, drive: { enabled: cfg.drive.enabled, remote: cfg.drive.remote, folder: cfg.drive.folder, ...driveState, queue: queue.length, uploading } };
}
export const archiveConfig = () => cfg;

// ---------- local save ----------
const safeName = n => String(n || 'file').split(/[\\/]/).pop().replace(/[<>:"|?*\u0000-\u001F]/g, '_').slice(0, 180) || 'file';
const dayDir = (d = new Date()) => path.join(String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));

/** Move an uploaded temp file into the archive. Returns the relative path (stored in MySQL files.storage_path). */
export async function saveLocal(tmpPath, { conversionId, role, name }) {
  if (!cfg.enabled) return null;
  const rel = path.join(dayDir(), String(conversionId), `${role}-${safeName(name)}`);
  const abs = path.join(cfg.dir, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  try { await fsp.rename(tmpPath, abs); } catch { await fsp.copyFile(tmpPath, abs); await fsp.unlink(tmpPath).catch(() => {}); }
  return rel.split(path.sep).join('/');
}
export const absPath = rel => {
  const p = path.resolve(cfg.dir, rel);
  if (!p.startsWith(cfg.dir + path.sep)) throw new Error('bad path'); // no escaping the archive dir
  return p;
};

// ---------- Google Drive upload queue (one at a time, retried) ----------
const queue = [];
let uploading = false;
let onDriveDone = null; // (fileId, {drive_file_id, drive_url}) => void — set by server.js to write back to MySQL
export const setDriveCallback = fn => { onDriveDone = fn; };

export function enqueueDrive(fileId, rel) {
  if (!cfg.enabled || !cfg.drive.enabled) return;
  queue.push({ fileId, rel, tries: 0 });
  pump();
}
async function pump() {
  if (uploading || !queue.length) return;
  uploading = true;
  const job = queue.shift();
  try {
    const st = await checkDrive();
    if (!st.ok) throw new Error(st.error || 'Drive not ready');
    const local = absPath(job.rel);
    const remotePath = `${cfg.drive.folder}/${job.rel.replace(/^(\d{4})\/(\d{2})\/(\d{2})\//, '$1-$2-$3/')}`;
    const target = `${cfg.drive.remote}:${remotePath}`;
    await rc(['copyto', local, target, '--drive-chunk-size', '32M', '--retries', '3', '--low-level-retries', '10'], 15 * 60 * 1000);
    // Fetch the Drive file id so the dashboard can link straight to it
    let id = null;
    try {
      const { stdout } = await rc(['lsjson', target, '--no-mimetype', '--no-modtime'], 60000);
      id = JSON.parse(stdout)?.[0]?.ID || null;
    } catch { /* link will fall back to the folder */ }
    const url = id ? `https://drive.google.com/file/d/${id}/view` : driveState.folderUrl;
    await onDriveDone?.(job.fileId, { drive_file_id: id, drive_url: url });
  } catch (e) {
    job.tries++;
    const msg = String(e.stderr || e.message).split('\n')[0].slice(0, 200);
    if (job.tries < 5) { console.warn(`[archive] Drive upload failed (${job.tries}/5), will retry: ${msg}`); setTimeout(() => { queue.push(job); pump(); }, 60000 * job.tries); }
    else console.error(`[archive] Drive upload gave up for ${job.rel}: ${msg}`);
  } finally {
    uploading = false;
    if (queue.length) setImmediate(pump);
  }
}

/** Re-queue files that are on disk but never reached Drive (e.g. Drive was offline / not yet authorised). */
export async function resumePending(rows) { for (const r of rows || []) enqueueDrive(r.id, r.storage_path); }

// ---------- retention sweeper ----------
export async function sweep(deleteRowsOlderThan) {
  if (!cfg.enabled || !(cfg.keepDays > 0)) return { local: 0 };
  const cutoff = Date.now() - cfg.keepDays * 86400000;
  let removed = 0;
  async function walk(dir) {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(p); try { if (!(await fsp.readdir(p)).length) await fsp.rmdir(p); } catch { /* ignore */ } }
      else { try { if ((await fsp.stat(p)).mtimeMs < cutoff) { await fsp.unlink(p); removed++; } } catch { /* ignore */ } }
    }
  }
  await walk(cfg.dir);
  if (cfg.drive.enabled && (await checkDrive()).ok) {
    try { await rc(['delete', `${cfg.drive.remote}:${cfg.drive.folder}`, '--min-age', `${cfg.keepDays}d`], 10 * 60 * 1000); await rc(['rmdirs', `${cfg.drive.remote}:${cfg.drive.folder}`, '--leave-root'], 5 * 60 * 1000); }
    catch (e) { console.warn('[archive] Drive sweep failed:', String(e.stderr || e.message).split('\n')[0]); }
  }
  await deleteRowsOlderThan?.(cfg.keepDays);
  return { local: removed };
}

/** Disk usage of the local archive (for the dashboard). */
export async function diskUsage() {
  let bytes = 0, files = 0;
  async function walk(dir) {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else { try { bytes += (await fsp.stat(p)).size; files++; } catch { /* ignore */ } } }
  }
  await walk(cfg.dir);
  return { bytes, files };
}

export async function initArchive() {
  if (!cfg.enabled) return false;
  await fsp.mkdir(cfg.dir, { recursive: true });
  if (cfg.drive.enabled) await checkDrive(true);
  return true;
}
export const rclonePath = () => rclone;
export const tmpDir = () => os.tmpdir();
