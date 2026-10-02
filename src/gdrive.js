// Google Drive via the REST API — no rclone binary, no persistent disk, works on Vercel and on a VPS alike.
// Uploads as YOU (OAuth refresh token obtained once with `npm run gdrive:auth`), so files land in your own
// Drive, in the folder GDRIVE_FOLDER_ID, owned by you. Nothing here runs unless GDRIVE_REFRESH_TOKEN is set.
import fsp from 'node:fs/promises';

const cfg = {
  clientId: process.env.GDRIVE_CLIENT_ID || '',
  clientSecret: process.env.GDRIVE_CLIENT_SECRET || '',
  refreshToken: process.env.GDRIVE_REFRESH_TOKEN || '',
  folderId: process.env.GDRIVE_FOLDER_ID || 'root',
};
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVES = 'supportsAllDrives=true'; // harmless on My Drive, required for shared drives

export const configured = () => Boolean(cfg.clientId && cfg.clientSecret && cfg.refreshToken);
export const folderUrl = id => `https://drive.google.com/drive/folders/${id}`;
export const fileUrl = id => `https://drive.google.com/file/d/${id}/view`;

// ---------- auth ----------
let token = { value: '', exp: 0 };
export async function accessToken() {
  if (token.value && Date.now() < token.exp) return token.value;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google login failed (${j.error || r.status}): ${j.error_description || 'check GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET / GDRIVE_REFRESH_TOKEN — run "npm run gdrive:auth" again'}`);
  token = { value: j.access_token, exp: Date.now() + (Number(j.expires_in || 3600) - 60) * 1000 };
  return token.value;
}

// Drive throttles per client project ("Quota exceeded … Requests per minute", 403/429) and has the odd 5xx.
// Retry those with exponential backoff (1 s → 16 s, ~30 s total) so a single upload survives a burst.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const transient = (status, msg = '') => status === 429 || status >= 500 || (status === 403 && /quota|rate ?limit/i.test(msg));
async function withRetry(fn, tries = 6) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= tries - 1 || !e.transient) throw e; await sleep(1000 * 2 ** i + Math.random() * 300); }
  }
}
async function api(path, init = {}, timeoutMs = 60000) {
  return withRetry(async () => {
    const t = await accessToken();
    const r = await fetch(path.startsWith('http') ? path : `${API}${path}`, { ...init, headers: { Authorization: `Bearer ${t}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 204) return null;
    const text = await r.text();
    const j = text ? JSON.parse(text) : {};
    if (!r.ok) throw Object.assign(new Error(`Drive API ${r.status}: ${j.error?.message || text.slice(0, 200)}`), { transient: transient(r.status, j.error?.message) });
    return j;
  });
}
const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); // escape for the Drive query language

// ---------- folders ----------
const folderCache = new Map(); // `${parentId}/${name}` → id
export async function ensureFolder(name, parentId) {
  const key = `${parentId}/${name}`;
  if (folderCache.has(key)) return folderCache.get(key);
  const found = await api(`/files?${DRIVES}&includeItemsFromAllDrives=true&pageSize=1&fields=files(id)&q=${encodeURIComponent(`name = '${q(name)}' and '${q(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`)}`);
  let id = found?.files?.[0]?.id;
  if (!id) id = (await api(`/files?${DRIVES}&fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }) })).id;
  folderCache.set(key, id);
  return id;
}
/** ["ConvertHub", "2026-10-02", "123"] → id of the innermost folder (created as needed). */
export async function ensurePath(parts, rootId = cfg.folderId) {
  let id = rootId;
  for (const p of parts) id = await ensureFolder(p, id);
  return id;
}

// ---------- upload ----------
/** Upload a local file (≤ ARCHIVE_MAX_FILE_MB, so one PUT is fine). Returns { id, url }. */
export async function uploadFile(localPath, { name, mime, parts }) {
  const parentId = await ensurePath(parts);
  const data = await fsp.readFile(localPath);
  return withRetry(async () => {
    const t = await accessToken();
    // Resumable session: metadata first, bytes second — reliable for any size and gives us the final file JSON.
    const start = await fetch(`${UPLOAD}?uploadType=resumable&${DRIVES}&fields=id,webViewLink`, {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime || 'application/octet-stream', 'X-Upload-Content-Length': String(data.length) },
      body: JSON.stringify({ name, parents: [parentId] }),
    });
    if (!start.ok) { const msg = (await start.text()).slice(0, 200); throw Object.assign(new Error(`Drive upload start ${start.status}: ${msg}`), { transient: transient(start.status, msg) }); }
    const session = start.headers.get('location');
    if (!session) throw new Error('Drive upload: no session URL');
    const put = await fetch(session, { method: 'PUT', signal: AbortSignal.timeout(10 * 60 * 1000), headers: { 'Content-Type': mime || 'application/octet-stream', 'Content-Length': String(data.length) }, body: data });
    const j = await put.json().catch(() => ({}));
    if (!put.ok || !j.id) throw Object.assign(new Error(`Drive upload ${put.status}: ${j.error?.message || 'unknown error'}`), { transient: transient(put.status, j.error?.message) });
    return { id: j.id, url: j.webViewLink || fileUrl(j.id) };
  });
}

// ---------- health + housekeeping ----------
/** Verify the login works and the target folder is reachable. Returns { ok, error, folderUrl, account }. */
export async function check() {
  try {
    const about = await api('/about?fields=user(emailAddress)', {}, 20000);
    const f = await api(`/files/${encodeURIComponent(cfg.folderId)}?${DRIVES}&fields=id,name,mimeType,trashed`, {}, 20000);
    if (f.mimeType !== FOLDER_MIME) throw new Error(`GDRIVE_FOLDER_ID is not a folder (${f.mimeType})`);
    if (f.trashed) throw new Error(`the Drive folder "${f.name}" is in the bin`);
    return { ok: true, error: null, folderUrl: folderUrl(f.id), folderName: f.name, account: about?.user?.emailAddress || null };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 300), folderUrl: cfg.folderId !== 'root' ? folderUrl(cfg.folderId) : null, account: null };
  }
}

/** Retention: move day-folders (named YYYY-MM-DD) older than `days` to the bin. Returns how many. */
export async function trashOlderThan(days, subFolder) {
  const rootId = subFolder ? await ensureFolder(subFolder, cfg.folderId) : cfg.folderId;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const list = await api(`/files?${DRIVES}&includeItemsFromAllDrives=true&pageSize=1000&fields=files(id,name)&q=${encodeURIComponent(`'${q(rootId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`)}`);
  let n = 0;
  for (const f of list?.files || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.name) || f.name >= cutoff) continue;
    await api(`/files/${f.id}?${DRIVES}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    n++;
  }
  return n;
}
