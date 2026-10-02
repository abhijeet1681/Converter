// PDF engine — pdf-lib (edit/create) + PDF.js (render/read), fully in the browser
import { loadScript, baseName, renameExt, parsePageRanges, canvasToBlob, flattenCanvas } from '../utils.js';

const SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };
async function PDFLib() { await loadScript('/vendor/pdf-lib/pdf-lib.min.js'); return window.PDFLib; }
async function pdfjs() {
  await loadScript('/vendor/pdfjs/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
  return window.pdfjsLib;
}
async function openPdfLib(file) {
  const { PDFDocument } = await PDFLib();
  try { return await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false }); }
  catch { throw new Error(`Could not read "${file.name}" — it may be damaged or not a PDF.`); }
}
async function openPdfJs(file) {
  const lib = await pdfjs();
  try { return await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
  catch (e) {
    if (e?.name === 'PasswordException') throw new Error('This PDF is password-protected. Please unlock it first.');
    throw new Error('Could not read this PDF file.');
  }
}
async function save(doc, name) {
  doc.setProducer('ConvertHub'); doc.setCreator('ConvertHub');
  const bytes = await doc.save({ useObjectStreams: true });
  return { name, blob: new Blob([bytes], { type: 'application/pdf' }) };
}
const pad = (n, total) => String(n).padStart(String(total).length, '0');
const hexToRgb = (hex, rgb) => { const n = parseInt(String(hex || '#000000').slice(1), 16) || 0; return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
// Standard PDF fonts only support Latin (WinAnsi) characters
const winAnsi = s => String(s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-')
  .replace(/\u2026/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');

async function renderPage(page, scale, type, quality) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  const blob = await canvasToBlob(c, type, quality);
  c.width = c.height = 0;
  return blob;
}

export async function pdfToImages(file, o, ctx) {
  const doc = await openPdfJs(file);
  const fmt = o.format === 'png' ? 'png' : 'jpg';
  const pages = parsePageRanges(o.pages, doc.numPages);
  const outs = [];
  for (let k = 0; k < pages.length; k++) {
    ctx.log(`Page ${k + 1}/${pages.length}`);
    const page = await doc.getPage(pages[k] + 1);
    const blob = await renderPage(page, (+o.dpi || 150) / 72, fmt === 'png' ? 'image/png' : 'image/jpeg', +o.quality || 0.9);
    outs.push({ name: `${baseName(file.name)}-page-${pad(pages[k] + 1, doc.numPages)}.${fmt}`, blob });
    page.cleanup();
    ctx.progress((k + 1) / pages.length);
  }
  await doc.destroy();
  return outs;
}

export async function imagesToPdf(files, o, ctx) {
  const { PDFDocument } = await PDFLib();
  const { decodeImage } = await import('./image.js');
  const pdf = await PDFDocument.create();
  const margin = +o.margin || 0;
  for (let i = 0; i < files.length; i++) {
    ctx.log(`Image ${i + 1}/${files.length}`);
    const f = files[i];
    const canvas = await decodeImage(f, ctx); // re-encoding applies EXIF rotation correctly
    const isPng = /png$/i.test(f.type) || /\.png$/i.test(f.name);
    const img = isPng
      ? await pdf.embedPng(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer())
      : await pdf.embedJpg(await (await canvasToBlob(flattenCanvas(canvas), 'image/jpeg', 0.92)).arrayBuffer());
    let pw, ph;
    if (!SIZES[o.pageSize]) { pw = img.width * 0.75 + margin * 2; ph = img.height * 0.75 + margin * 2; }
    else {
      [pw, ph] = SIZES[o.pageSize];
      if (o.orientation === 'landscape' || (o.orientation !== 'portrait' && img.width > img.height)) [pw, ph] = [ph, pw];
    }
    const page = pdf.addPage([pw, ph]);
    const r = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
    const w = img.width * r, h = img.height * r;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    ctx.progress((i + 1) / files.length);
  }
  return [await save(pdf, files.length === 1 ? renameExt(files[0].name, 'pdf') : 'images.pdf')];
}

export async function mergePdf(files, o, ctx) {
  const { PDFDocument } = await PDFLib();
  const out = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    ctx.log(`Merging ${i + 1}/${files.length}`);
    const src = await openPdfLib(files[i]);
    (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
    ctx.progress((i + 1) / files.length);
  }
  return [await save(out, 'merged.pdf')];
}

async function pagesToDoc(src, indexes) {
  const { PDFDocument } = await PDFLib();
  const doc = await PDFDocument.create();
  (await doc.copyPages(src, indexes)).forEach(p => doc.addPage(p));
  return doc;
}

export async function splitPdf(file, o, ctx) {
  const src = await openPdfLib(file);
  const n = src.getPageCount(), base = baseName(file.name);
  let groups;
  if (o.splitMode === 'every') {
    const k = Math.max(1, parseInt(o.every, 10) || 1);
    groups = [];
    for (let i = 0; i < n; i += k) groups.push([...Array(Math.min(k, n - i)).keys()].map(j => i + j));
  } else if (o.splitMode === 'ranges') {
    groups = String(o.ranges || '').split(',').map(s => s.trim()).filter(Boolean).map(s => parsePageRanges(s, n));
    if (!groups.length) throw new Error('Enter at least one range, e.g. 1-3, 4-6');
  } else groups = [...Array(n).keys()].map(i => [i]);
  const outs = [];
  for (let g = 0; g < groups.length; g++) {
    const p = groups[g];
    const label = p.length === 1 ? `page-${pad(p[0] + 1, n)}` : `pages-${p[0] + 1}-${p[p.length - 1] + 1}`;
    outs.push(await save(await pagesToDoc(src, p), `${base}-${label}.pdf`));
    ctx.progress((g + 1) / groups.length);
  }
  return outs;
}

export async function extractPages(file, o) {
  const src = await openPdfLib(file);
  return [await save(await pagesToDoc(src, parsePageRanges(o.pages, src.getPageCount())), `${baseName(file.name)}-extracted.pdf`)];
}

export async function removePages(file, o) {
  const src = await openPdfLib(file);
  const n = src.getPageCount();
  const remove = new Set(parsePageRanges(o.pages, n));
  const keep = [...Array(n).keys()].filter(i => !remove.has(i));
  if (!keep.length) throw new Error('You cannot remove every page.');
  return [await save(await pagesToDoc(src, keep), `${baseName(file.name)}-edited.pdf`)];
}

export async function organizePdf(file, o) {
  const src = await openPdfLib(file);
  const order = parsePageRanges(o.order, src.getPageCount(), { unique: false });
  return [await save(await pagesToDoc(src, order), `${baseName(file.name)}-reordered.pdf`)];
}

export async function rotatePdf(file, o) {
  const { degrees } = await PDFLib();
  const doc = await openPdfLib(file);
  const sel = new Set(parsePageRanges(o.pages, doc.getPageCount()));
  doc.getPages().forEach((p, i) => { if (sel.has(i)) p.setRotation(degrees((p.getRotation().angle + (+o.angle || 90)) % 360)); });
  return [await save(doc, `${baseName(file.name)}-rotated.pdf`)];
}

export async function compressPdf(file, o, ctx) {
  const preset = { low: [150, 0.8], medium: [110, 0.65], high: [80, 0.5] }[o.level] || [110, 0.65];
  const src = await openPdfJs(file);
  const { PDFDocument } = await PDFLib();
  const out = await PDFDocument.create();
  for (let i = 1; i <= src.numPages; i++) {
    ctx.log(`Page ${i}/${src.numPages}`);
    const page = await src.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const jpg = await renderPage(page, preset[0] / 72, 'image/jpeg', preset[1]);
    const img = await out.embedJpg(await jpg.arrayBuffer());
    out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    page.cleanup();
    ctx.progress(i / src.numPages);
  }
  await src.destroy();
  const res = await save(out, `${baseName(file.name)}-compressed.pdf`);
  if (res.blob.size >= file.size) return [{ name: file.name, blob: file, info: 'already optimized — original kept' }];
  return [res];
}

/** PDF → Word (DOCX). Text + paragraph structure only (no images/exact layout) — fully in the browser. */
export async function pdfToWord(file, o, ctx) {
  const doc = await openPdfJs(file);
  const pages = parsePageRanges(o.pages, doc.numPages);
  const paras = [];
  for (let k = 0; k < pages.length; k++) {
    const page = await doc.getPage(pages[k] + 1);
    const tc = await page.getTextContent();
    // Group text items into lines by their Y position, then lines into paragraphs by vertical gaps
    let lines = [], cur = null, lastY = null, lastH = 0;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform[5]), hgt = Math.abs(it.transform[3]) || 10;
      if (cur && lastY !== null && Math.abs(y - lastY) < hgt * 0.5) cur.text += (it.str.startsWith(' ') || cur.text.endsWith(' ') ? '' : ' ') + it.str;
      else { if (cur) lines.push(cur); cur = { text: it.str, y, gap: lastY === null ? 0 : lastY - y, h: hgt }; }
      lastY = y; lastH = hgt;
    }
    if (cur) lines.push(cur);
    let p = '';
    for (const ln of lines) {
      const t = ln.text.trim();
      if (!t) continue;
      if (p && ln.gap > ln.h * 1.6) { paras.push({ text: p, size: ln.h }); p = ''; }
      p += (p ? ' ' : '') + t;
    }
    if (p) paras.push({ text: p, size: lastH });
    if (k < pages.length - 1) paras.push({ pageBreak: true });
    ctx.progress(0.8 * (k + 1) / pages.length);
  }
  await doc.destroy();
  if (!paras.some(x => x.text)) throw new Error('No text found — this PDF is probably a scanned image. Try "Image to Text (OCR)" first.');
  ctx.log('Building Word file…');
  await loadScript('/vendor/jszip/jszip.min.js');
  const zip = new window.JSZip();
  const xmlEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const body = paras.map(x => x.pageBreak ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    : `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:rPr><w:sz w:val="${Math.max(16, Math.min(56, Math.round((x.size || 11) * 2)))}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(x.text)}</w:t></w:r></w:p>`).join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  ctx.progress(1);
  return [{ name: renameExt(file.name, 'docx'), blob, info: `${paras.filter(x => x.text).length} paragraphs · text only` }];
}

export async function pdfToText(file, o, ctx) {
  const doc = await openPdfJs(file);
  const pages = parsePageRanges(o.pages, doc.numPages);
  let text = '';
  for (let k = 0; k < pages.length; k++) {
    const tc = await (await doc.getPage(pages[k] + 1)).getTextContent();
    text += `--- Page ${pages[k] + 1} ---\n`;
    for (const it of tc.items) if ('str' in it) text += it.str + (it.hasEOL ? '\n' : '');
    text += '\n\n';
    ctx.progress((k + 1) / pages.length);
  }
  await doc.destroy();
  if (!text.replace(/--- Page \d+ ---|\s/g, '')) throw new Error('No text found — this PDF is probably a scanned image (OCR is not supported).');
  return [{ name: renameExt(file.name, 'txt'), blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) }];
}

export async function watermarkPdf(file, o) {
  const { StandardFonts, rgb, degrees } = await PDFLib();
  const doc = await openPdfLib(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = winAnsi(o.text || 'CONFIDENTIAL'), size = +o.size || 60, color = hexToRgb(o.color, rgb);
  const sel = new Set(parsePageRanges(o.pages, doc.getPageCount()));
  const a = Math.PI / 4, tw = font.widthOfTextAtSize(text, size);
  doc.getPages().forEach((p, i) => {
    if (!sel.has(i)) return;
    const { width, height } = p.getSize();
    p.drawText(text, {
      x: width / 2 - (tw / 2) * Math.cos(a) + (size / 3) * Math.sin(a),
      y: height / 2 - (tw / 2) * Math.sin(a) - (size / 3) * Math.cos(a),
      size, font, color, opacity: +o.opacity || 0.2, rotate: degrees(45),
    });
  });
  return [await save(doc, `${baseName(file.name)}-watermarked.pdf`)];
}

export async function pageNumbers(file, o) {
  const { StandardFonts, rgb } = await PDFLib();
  const doc = await openPdfLib(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages(), total = pages.length, size = +o.size || 11;
  const start = Number.isFinite(parseInt(o.start, 10)) ? parseInt(o.start, 10) : 1;
  pages.forEach((p, i) => {
    const n = start + i, last = start + total - 1;
    const label = { n: `${n}`, 'page-n': `Page ${n}`, 'n-of': `${n} / ${last}`, 'page-n-of': `Page ${n} of ${last}` }[o.format] || `${n}`;
    const { width, height } = p.getSize();
    const tw = font.widthOfTextAtSize(label, size), m = 28;
    const pos = o.position || 'bottom-center';
    const x = pos.endsWith('left') ? m : pos.endsWith('right') ? width - m - tw : (width - tw) / 2;
    const y = pos.startsWith('top') ? height - m - size : m;
    p.drawText(label, { x, y, size, font, color: rgb(0.2, 0.2, 0.2) });
  });
  return [await save(doc, `${baseName(file.name)}-numbered.pdf`)];
}

function wrapLine(line, font, size, maxW) {
  if (!line) return [''];
  const out = [];
  let cur = '';
  for (const word of line.split(' ')) {
    const test = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxW) { cur = test; continue; }
    if (cur) out.push(cur);
    if (font.widthOfTextAtSize(word, size) <= maxW) { cur = word; continue; }
    let chunk = '';
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > maxW) { out.push(chunk); chunk = ch; } else chunk += ch;
    }
    cur = chunk;
  }
  out.push(cur);
  return out;
}

export async function textToPdfBlob(text, o = {}) {
  const { PDFDocument, StandardFonts, rgb } = await PDFLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont({ mono: StandardFonts.Courier, serif: StandardFonts.TimesRoman }[o.font] || StandardFonts.Helvetica);
  const size = +o.fontSize || 11, [W, H] = SIZES[o.pageSize] || SIZES.a4, M = 56, lh = size * 1.45;
  let page = doc.addPage([W, H]), y = H - M;
  for (const raw of winAnsi(text).replace(/\t/g, '    ').split(/\r?\n/)) {
    for (const line of wrapLine(raw, font, size, W - M * 2)) {
      if (y - size < M) { page = doc.addPage([W, H]); y = H - M; }
      if (line) page.drawText(line, { x: M, y: y - size, size, font, color: rgb(0.1, 0.1, 0.12) });
      y -= lh;
    }
  }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

export async function txtToPdf(file, o) {
  return [{ name: renameExt(file.name, 'pdf'), blob: await textToPdfBlob(await file.text(), o) }];
}
