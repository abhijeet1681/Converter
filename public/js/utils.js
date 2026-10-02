// Shared helpers (DOM, files, formatting)
export const $ = (sel, root = document) => root.querySelector(sel);

/** Safe DOM builder: text children are inserted as text (never as HTML) => no XSS from file names. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** <svg><use href="#id"/></svg> from the sprite in index.html (h() can't build SVG — it needs the SVG namespace). */
export function svgUse(id, cls, label) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

const scripts = new Map();
/** Lazy-load a classic script once (libraries are only downloaded when a tool needs them). */
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => { scripts.delete(src); reject(new Error(`Failed to load ${src}. Did you run "npm install"?`)); };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i];
}
export const extOf = name => { const i = String(name).lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
export const baseName = name => { const s = String(name).split('/').pop(); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(0, i) : s; };
export const renameExt = (name, ext) => `${baseName(name)}.${ext}`;

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) =>
  canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Your browser could not encode this image (it may be too large).'))), type, quality));

export function flattenCanvas(src, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.fillStyle = color || '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0);
  return c;
}

/** "1-3, 5, 8-last, odd, even, all" -> zero-based page indexes */
export function parsePageRanges(input, total, { unique = true } = {}) {
  const s = String(input ?? '').trim().toLowerCase();
  const all = [...Array(total).keys()];
  if (!s || s === 'all') return all;
  if (s === 'odd') return all.filter(i => i % 2 === 0);
  if (s === 'even') return all.filter(i => i % 2 === 1);
  const out = [];
  for (const part of s.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+|last)?\s*(-\s*(\d+|last)?)?$/);
    if (!m || (!m[1] && !m[2])) throw new Error(`Invalid page range "${p}". Use formats like 1-3, 5, 8-last.`);
    const num = v => (v === 'last' ? total : parseInt(v, 10));
    const a = m[1] ? num(m[1]) : 1;
    const b = m[2] ? (m[3] ? num(m[3]) : total) : a;
    if (a < 1 || b < 1 || a > total || b > total) throw new Error(`Page range "${p}" is outside this document (1–${total}).`);
    const step = a <= b ? 1 : -1;
    for (let i = a; step > 0 ? i <= b : i >= b; i += step) out.push(i - 1);
  }
  if (!out.length) throw new Error('No pages selected.');
  return unique ? [...new Set(out)] : out;
}

export function toast(message, type = 'info') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = h('div', { class: `toast ${type}`, role: 'status' }, message);
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, type === 'error' ? 6500 : 4200);
}
