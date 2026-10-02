// Copies browser libraries from node_modules into public/vendor so they are
// served from YOUR domain (required for FFmpeg web workers + strict security headers).
// Runs automatically after "npm install". Run manually with: npm run vendor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'public', 'vendor');

const jobs = [
  { dir: '@ffmpeg/ffmpeg/dist/umd', to: 'ffmpeg' },
  { dir: '@ffmpeg/core/dist/umd', to: 'ffmpeg-core' },
  { file: ['pdf-lib/dist/pdf-lib.min.js', 'pdf-lib/dist/pdf-lib.js'], to: 'pdf-lib/pdf-lib.min.js' },
  { file: ['pdfjs-dist/build/pdf.min.js', 'pdfjs-dist/build/pdf.js'], to: 'pdfjs/pdf.min.js' },
  { file: ['pdfjs-dist/build/pdf.worker.min.js', 'pdfjs-dist/build/pdf.worker.js'], to: 'pdfjs/pdf.worker.min.js' },
  { file: ['xlsx/dist/xlsx.full.min.js'], to: 'xlsx/xlsx.full.min.js' },
  { file: ['jszip/dist/jszip.min.js', 'jszip/dist/jszip.js'], to: 'jszip/jszip.min.js' },
  { file: ['mammoth/mammoth.browser.min.js', 'mammoth/mammoth.browser.js'], to: 'mammoth/mammoth.browser.min.js' },
  { file: ['heic2any/dist/heic2any.min.js', 'heic2any/dist/heic2any.js'], to: 'heic2any/heic2any.js' },
];

const required = [
  'ffmpeg/ffmpeg.js', 'ffmpeg-core/ffmpeg-core.js', 'ffmpeg-core/ffmpeg-core.wasm',
  'pdf-lib/pdf-lib.min.js', 'pdfjs/pdf.min.js', 'pdfjs/pdf.worker.min.js',
  'xlsx/xlsx.full.min.js', 'jszip/jszip.min.js', 'mammoth/mammoth.browser.min.js', 'heic2any/heic2any.js',
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let problems = 0;
for (const job of jobs) {
  const dest = path.join(out, job.to);
  if (job.dir) {
    const src = path.join(nm, job.dir);
    if (!fs.existsSync(src)) { console.warn('  ! missing ' + job.dir); problems++; continue; }
    fs.cpSync(src, dest, { recursive: true });
  } else {
    const src = job.file.map(f => path.join(nm, f)).find(f => fs.existsSync(f));
    if (!src) { console.warn('  ! missing ' + job.file[0]); problems++; continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  console.log('  ✓ vendor/' + job.to);
}

const missing = required.filter(f => !fs.existsSync(path.join(out, f)));
if (missing.length || problems) {
  console.warn('\n[ConvertHub] Some browser libraries are missing:\n  ' + missing.join('\n  '));
  console.warn('Try deleting node_modules and running "npm install" again.\n');
} else {
  console.log('\n[ConvertHub] All browser libraries are ready in public/vendor ✓\n');
}
