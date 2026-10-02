// Image engine: decode (incl. HEIC/SVG/TIFF fallback) -> transform -> encode
import { loadScript, extOf, baseName, canvasToBlob, flattenCanvas } from '../utils.js';

const NORMAL = { jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg', pjpeg: 'jpg', tif: 'tiff', heif: 'heic' };
const norm = e => NORMAL[e] || e;

function loadImg(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

/** Returns a canvas with the decoded image (EXIF orientation applied by the browser). */
export async function decodeImage(file, ctx) {
  let src = file;
  const ext = norm(extOf(file.name || ''));
  if (ext === 'heic' || /image\/hei[cf]/.test(file.type || '')) {
    ctx?.log?.('Decoding HEIC…');
    await loadScript('/vendor/heic2any/heic2any.js');
    try {
      const r = await window.heic2any({ blob: file, toType: 'image/png' });
      src = Array.isArray(r) ? r[0] : r;
    } catch { throw new Error('Could not decode this HEIC/HEIF image.'); }
  }
  let img;
  try {
    img = await loadImg(src);
  } catch {
    // Formats browsers can't read natively (TIFF, TGA, PSD-like…) -> FFmpeg fallback
    ctx?.log?.('Using FFmpeg decoder…');
    const { runFFmpeg } = await import('./media.js');
    try { img = await loadImg(await runFFmpeg(file, 'png', ['-frames:v', '1'], ctx)); } catch { throw new Error('Unsupported or damaged image file.'); }
  }
  const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  return c;
}

function transform(src, o) {
  const W = src.width, H = src.height;
  let w = W, h = H;
  const tw = parseInt(o.width, 10) || 0, th = parseInt(o.height, 10) || 0;
  if (tw || th) {
    if (tw && th) {
      if (o.keepAspect === false) { w = tw; h = th; } else { const r = Math.min(tw / W, th / H); w = W * r; h = H * r; }
    } else if (tw) { w = tw; h = (H * tw) / W; } else { h = th; w = (W * th) / H; }
    if (o.keepSmaller && w > W) { w = W; h = H; } // compress tool: never upscale
  } else if (o.scale && +o.scale !== 100) { w = (W * o.scale) / 100; h = (H * o.scale) / 100; }
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const rot = (((+o.rotate || 0) % 360) + 360) % 360;
  if (w === W && h === H && !rot && !o.flipH && !o.flipV && !o.grayscale) return src;
  const swap = rot === 90 || rot === 270;
  const c = document.createElement('canvas');
  c.width = swap ? h : w; c.height = swap ? w : h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.translate(c.width / 2, c.height / 2);
  g.rotate((rot * Math.PI) / 180);
  g.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
  g.drawImage(src, -w / 2, -h / 2, w, h);
  if (o.grayscale) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const y = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = y; }
    g.putImageData(d, 0, 0);
  }
  return c;
}

function encodeBMP(canvas) {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const row = Math.ceil((w * 3) / 4) * 4, size = 54 + row * h;
  const buf = new ArrayBuffer(size), dv = new DataView(buf), bytes = new Uint8Array(buf);
  bytes[0] = 0x42; bytes[1] = 0x4d;
  dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
  dv.setUint32(34, row * h, true); dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    const r = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = r + x * 3;
      bytes[o] = data[i + 2]; bytes[o + 1] = data[i + 1]; bytes[o + 2] = data[i];
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

async function encodeICO(src) {
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const r = Math.min(s / src.width, s / src.height), w = src.width * r, h = src.height * r;
    g.drawImage(src, (s - w) / 2, (s - h) / 2, w, h);
    pngs.push(new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer()));
  }
  const head = 6 + 16 * sizes.length;
  const buf = new Uint8Array(head + pngs.reduce((a, p) => a + p.length, 0));
  const dv = new DataView(buf.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, sizes.length, true);
  let off = head;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    buf[e] = s >= 256 ? 0 : s; buf[e + 1] = s >= 256 ? 0 : s;
    dv.setUint16(e + 4, 1, true); dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, pngs[i].length, true); dv.setUint32(e + 12, off, true);
    buf.set(pngs[i], off); off += pngs[i].length;
  });
  return new Blob([buf], { type: 'image/x-icon' });
}

async function encode(canvas, to, o, ctx) {
  const q = Math.min(1, Math.max(0.05, +o.quality || 0.9));
  if (to === 'jpg') return canvasToBlob(flattenCanvas(canvas, o.background), 'image/jpeg', q);
  if (to === 'png') return canvasToBlob(canvas, 'image/png');
  if (to === 'bmp') return encodeBMP(flattenCanvas(canvas, o.background));
  if (to === 'ico') return encodeICO(canvas);
  const { runFFmpeg } = await import('./media.js');
  const pngFile = async () => new File([await canvasToBlob(canvas, 'image/png')], 'frame.png', { type: 'image/png' });
  if (to === 'webp') {
    const b = await canvasToBlob(canvas, 'image/webp', q);
    if (b.type === 'image/webp') return b;
    ctx?.log?.('Encoding WEBP with FFmpeg…'); // Safari can't encode WEBP natively
    return runFFmpeg(await pngFile(), 'webp', ['-quality', String(Math.round(q * 100))], ctx);
  }
  if (to === 'gif') {
    ctx?.log?.('Encoding GIF…');
    return runFFmpeg(await pngFile(), 'gif', ['-vf', 'split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse'], ctx);
  }
  throw new Error(`Unsupported output format: ${to}`);
}

export async function convert(file, o, ctx) {
  const srcExt = norm(extOf(file.name));
  const to = !o.to || o.to === 'same' ? (['jpg', 'png', 'webp', 'bmp'].includes(srcExt) ? srcExt : 'png') : o.to;
  ctx.log('Decoding…');
  const canvas = transform(await decodeImage(file, ctx), o);
  ctx.progress(0.5);
  ctx.log('Encoding…');
  let blob = await encode(canvas, to, o, ctx);
  let info = '';
  if (o.keepSmaller && to === srcExt && blob.size >= file.size && canvas.width && !(parseInt(o.width, 10) < canvas.width)) {
    blob = file; info = 'already optimized — original kept';
  }
  ctx.progress(1);
  return [{ name: `${baseName(file.name)}${o.suffix ? '-' + o.suffix : ''}.${to}`, blob, info }];
}
