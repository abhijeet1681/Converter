// Archive & utility engine — ZIP (JSZip), Base64, checksums (Web Crypto)
import { loadScript, extOf, baseName } from '../utils.js';

async function JSZipLib() { await loadScript('/vendor/jszip/jszip.min.js'); return window.JSZip; }
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  pdf: 'application/pdf', txt: 'text/plain', html: 'text/html', json: 'application/json', csv: 'text/csv', zip: 'application/zip',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
};
const EXT = Object.fromEntries(Object.entries(MIME).filter(([k]) => k !== 'jpeg').map(([k, v]) => [v, k]));

function unique(name, used) {
  if (!used.has(name)) { used.set(name, 1); return name; }
  const n = used.get(name) + 1;
  used.set(name, n);
  const ext = extOf(name);
  return `${name.slice(0, ext ? -(ext.length + 1) : undefined)} (${n})${ext ? '.' + ext : ''}`;
}

/** Used by the "Download all as ZIP" button */
export async function zipOutputs(outputs) {
  const JSZip = await JSZipLib();
  const zip = new JSZip(), used = new Map();
  for (const o of outputs) zip.file(unique(o.name, used), o.blob);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function createZip(files, o, ctx) {
  const JSZip = await JSZipLib();
  const zip = new JSZip(), used = new Map();
  for (const f of files) zip.file(unique(f.name, used), f);
  const level = parseInt(o.level, 10);
  const blob = await zip.generateAsync(
    { type: 'blob', compression: level === 0 ? 'STORE' : 'DEFLATE', compressionOptions: { level: level || 6 } },
    m => ctx.progress(m.percent / 100));
  const name = String(o.name || 'archive').replace(/[\\/:*?"<>|]/g, '_').replace(/\.zip$/i, '') || 'archive';
  return [{ name: `${name}.zip`, blob }];
}

export async function extractZip(file, o, ctx) {
  const JSZip = await JSZipLib();
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new Error('Could not open this ZIP (it may be damaged, encrypted or not a ZIP file).'); }
  const entries = Object.values(zip.files).filter(e => !e.dir && !e.name.startsWith('__MACOSX/') && !e.name.endsWith('.DS_Store'));
  if (!entries.length) throw new Error('This ZIP file is empty.');
  const outs = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const data = await e.async('blob');
    outs.push({ name: e.name, blob: new Blob([data], { type: MIME[extOf(e.name)] || 'application/octet-stream' }) });
    ctx.progress((i + 1) / entries.length);
  }
  return outs;
}

export async function fileToBase64(file, o) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const raw = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const text = { raw, css: `background-image: url("${dataUrl}");`, html: `<img src="${dataUrl}" alt="">` }[o.format] || dataUrl;
  return [{ name: `${file.name}.base64.txt`, blob: new Blob([text], { type: 'text/plain' }), text, info: `${text.length.toLocaleString()} characters` }];
}

function sniff(b) {
  const s = (...x) => x.every((v, i) => b[i] === v);
  if (s(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (s(0xff, 0xd8, 0xff)) return 'jpg';
  if (s(0x47, 0x49, 0x46)) return 'gif';
  if (s(0x25, 0x50, 0x44, 0x46)) return 'pdf';
  if (s(0x50, 0x4b, 0x03, 0x04)) return 'zip';
  if (s(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  return null;
}

export async function base64ToFile(file) {
  let text = (await file.text()).trim();
  let mime = '';
  const m = text.match(/^data:([^;,]+)?(?:;[^,]*)?,/);
  if (m) { mime = m[1] || ''; text = text.slice(m[0].length); }
  text = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!text || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('This file does not contain valid Base64 data.');
  while (text.length % 4) text += '=';
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = EXT[mime] || sniff(bytes) || 'bin';
  const base = baseName(file.name.replace(/\.(base64|b64)\.txt$/i, '.txt'));
  return [{ name: `${base}-decoded.${ext}`, blob: new Blob([bytes], { type: MIME[ext] || 'application/octet-stream' }) }];
}

export async function fileChecksum(file, o, ctx) {
  if (!window.crypto?.subtle) throw new Error('Checksums need a secure connection (HTTPS or localhost).');
  const algos = o.algo === 'all' ? ['SHA-1', 'SHA-256', 'SHA-512'] : [o.algo || 'SHA-256'];
  ctx.log('Reading file…');
  const buf = await file.arrayBuffer();
  const lines = [];
  for (let i = 0; i < algos.length; i++) {
    const d = await crypto.subtle.digest(algos[i], buf);
    lines.push(`${algos[i]}: ${[...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')}`);
    ctx.progress((i + 1) / algos.length);
  }
  const text = `File: ${file.name}\nSize: ${file.size} bytes\n\n${lines.join('\n')}\n`;
  return [{ name: `${file.name}.checksum.txt`, blob: new Blob([text], { type: 'text/plain' }), text: lines.join('\n'), info: lines[0].slice(0, 40) + '…' }];
}
