// One-time Google Drive login for the archive — produces the three values the server needs to upload
// to YOUR Drive without rclone (works on Vercel, a VPS, this laptop — anywhere):
//     GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN
//
//   npm run gdrive:auth                              → uses GDRIVE_CLIENT_ID/SECRET from .env
//   npm run gdrive:auth -- --client-id … --client-secret …
//   add --no-write to only print the values instead of saving them into .env
//
// Before the first run you need a Google OAuth client of your own (5 minutes, free, once):
//   1. https://console.cloud.google.com/ → create/select a project
//   2. APIs & Services → Library → enable "Google Drive API"
//   3. APIs & Services → OAuth consent screen → External → fill app name + your e-mail → add yourself under "Test users"
//      (or press "Publish app" so the token never expires after 7 days)
//   4. APIs & Services → Credentials → Create credentials → OAuth client ID → Application type: **Desktop app**
//   5. Copy the Client ID and Client secret into .env (GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET) and run this script.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../src/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const args = process.argv.slice(2);
const arg = n => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : undefined; };
loadEnvFile(envPath);

const clientId = arg('client-id') || process.env.GDRIVE_CLIENT_ID;
const clientSecret = arg('client-secret') || process.env.GDRIVE_CLIENT_SECRET;
const folderId = arg('folder') || process.env.GDRIVE_FOLDER_ID || '';
if (!clientId || !clientSecret) {
  console.error('\n✗ GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET are empty. Create a Google OAuth client first (steps at the top of scripts/gdrive-auth.js),');
  console.error('  put the two values in .env, then run this again.\n');
  process.exit(1);
}

// Loopback redirect — allowed for "Desktop app" clients on any port, no registration needed.
const state = crypto.randomBytes(12).toString('hex');
const server = http.createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const redirectUri = `http://127.0.0.1:${server.address().port}/`;
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', state,
  scope: 'https://www.googleapis.com/auth/drive', // full Drive: needed to write into a folder YOU created (drive.file would only see files the app made)
});

console.log('\nOpening Google sign-in in your browser… If nothing opens, copy this link:\n\n' + authUrl + '\n');
const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', authUrl.replace(/&/g, '^&')]] : process.platform === 'darwin' ? ['open', [authUrl]] : ['xdg-open', [authUrl]];
execFile(opener[0], opener[1], () => {});

const code = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timed out after 5 minutes')), 5 * 60 * 1000);
  server.on('request', (req, res) => {
    const u = new URL(req.url, redirectUri);
    if (u.pathname !== '/') { res.writeHead(404).end(); return; }
    const err = u.searchParams.get('error');
    if (err || u.searchParams.get('state') !== state || !u.searchParams.get('code')) {
      res.writeHead(400, { 'Content-Type': 'text/html' }).end('<h2 style="font-family:sans-serif">Login failed — go back to the terminal.</h2>');
      clearTimeout(t); reject(new Error(err || 'bad callback')); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h2 style="font-family:sans-serif">✅ ConvertHub is connected to your Google Drive. You can close this tab.</h2>');
    clearTimeout(t); resolve(u.searchParams.get('code'));
  });
}).finally(() => server.close());

const tok = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
}).then(r => r.json());
if (!tok.refresh_token) { console.error('\n✗ Google did not return a refresh token:', tok.error_description || JSON.stringify(tok)); process.exit(1); }

// Prove it works: who am I, and can I see the archive folder?
const g = p => fetch(`https://www.googleapis.com/drive/v3/${p}`, { headers: { Authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());
const me = await g('about?fields=user(emailAddress)');
let folderLine = '  (GDRIVE_FOLDER_ID is empty — files will go to the top level of My Drive / ConvertHub)';
if (folderId) {
  const f = await g(`files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType`);
  folderLine = f.id ? `  Folder          : "${f.name}"  https://drive.google.com/drive/folders/${f.id} ✓` : `  ✗ Folder ${folderId} not reachable with this account: ${f.error?.message || 'unknown error'}`;
}
console.log(`\n✓ Connected as ${me.user?.emailAddress || '(unknown account)'}\n${folderLine}\n`);

const values = { GDRIVE_CLIENT_ID: clientId, GDRIVE_CLIENT_SECRET: clientSecret, GDRIVE_REFRESH_TOKEN: tok.refresh_token, GDRIVE_ENABLED: 'true' };
if (!args.includes('--no-write') && fs.existsSync(envPath)) {
  let env = fs.readFileSync(envPath, 'utf8');
  for (const [k, v] of Object.entries(values)) env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : env.replace(/\s*$/, `\n${k}=${v}\n`);
  fs.writeFileSync(envPath, env);
  console.log('Saved into .env (git-ignored). Restart the website: npm start\n');
}
console.log('For the LIVE site paste these into Vercel → Project → Settings → Environment Variables (and ARCHIVE_FILES=true, GDRIVE_FOLDER_ID=…):\n');
for (const [k, v] of Object.entries(values)) console.log(`${k}=${v}`);
console.log('\n🔐 The refresh token is a key to your Drive — never commit it or paste it in chats. Revoke any time at https://myaccount.google.com/permissions\n');
