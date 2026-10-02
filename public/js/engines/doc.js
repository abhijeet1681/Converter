// Document engine — Office via server (LibreOffice), DOCX via mammoth, Markdown/HTML in-browser
import { loadScript, extOf, baseName, renameExt } from '../utils.js';

const MIME = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html;charset=utf-8', txt: 'text/plain;charset=utf-8',
};
async function mammoth() { await loadScript('/vendor/mammoth/mammoth.browser.min.js'); return window.mammoth; }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{max-width:820px;margin:40px auto;padding:0 20px;font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d2b}
img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 10px}
pre{background:#f4f4f8;padding:14px;border-radius:8px;overflow:auto}code{background:#f4f4f8;padding:2px 5px;border-radius:4px}
blockquote{border-left:4px solid #6d5dfc;margin:0;padding:4px 16px;color:#555}</style></head>
<body>
${body}
</body></html>`;

function uploadConvert(file, to, ctx) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('to', to);
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/convert/office');
    xhr.responseType = 'blob';
    xhr.upload.onprogress = e => { if (e.lengthComputable) { ctx.log('Uploading…'); ctx.progress((0.6 * e.loaded) / e.total); } };
    xhr.upload.onload = () => ctx.log('Converting on server…');
    xhr.onload = async () => {
      if (xhr.status === 200) { ctx.progress(1); return resolve(xhr.response); }
      let data = {};
      try { data = JSON.parse(await xhr.response.text()); } catch { /* not json */ }
      const err = new Error(data.error || `Server error (${xhr.status})`);
      err.code = data.code || (xhr.status === 404 ? 'NO_SERVER' : 'HTTP');
      reject(err);
    };
    xhr.onerror = () => { const e = new Error('Could not reach the server.'); e.code = 'NETWORK'; reject(e); };
    xhr.send(fd);
  });
}

export async function officeConvert(file, o, ctx) {
  const to = o.to || 'pdf';
  try {
    const blob = await uploadConvert(file, to, ctx);
    return [{ name: renameExt(file.name, to), blob: new Blob([blob], { type: MIME[to] || 'application/octet-stream' }) }];
  } catch (e) {
    // Graceful fallback: DOCX -> basic text PDF, entirely in the browser
    if (o.fallback && extOf(file.name) === 'docx' && ['NO_OFFICE', 'DISABLED', 'NETWORK', 'NO_SERVER'].includes(e.code)) {
      ctx.log('Basic in-browser conversion…');
      const m = await mammoth();
      const { value } = await m.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      const { textToPdfBlob } = await import('./pdf.js');
      return [{ name: renameExt(file.name, 'pdf'), blob: await textToPdfBlob(value), info: 'basic text-only mode' }];
    }
    throw e;
  }
}

export async function docxToHtml(file) {
  const m = await mammoth();
  const r = await m.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return [{ name: renameExt(file.name, 'html'), blob: new Blob([page(baseName(file.name), r.value)], { type: MIME.html }) }];
}

export async function docxToText(file) {
  const m = await mammoth();
  const r = await m.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return [{ name: renameExt(file.name, 'txt'), blob: new Blob([r.value], { type: MIME.txt }) }];
}

export async function htmlToText(file) {
  const doc = new DOMParser().parseFromString(await file.text(), 'text/html'); // scripts never execute here
  doc.querySelectorAll('script,style,noscript,template').forEach(n => n.remove());
  doc.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
  doc.querySelectorAll('li').forEach(n => n.prepend('• '));
  doc.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,tr,section,article,header,footer,blockquote,pre,table').forEach(n => n.append('\n'));
  const text = (doc.body?.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return [{ name: renameExt(file.name, 'txt'), blob: new Blob([text], { type: MIME.txt }) }];
}

// ---- Tiny, safe Markdown renderer (headings, lists, tasks, tables, code, quotes, links, images)
const safeUrl = u => (/^\s*(javascript|vbscript|data):/i.test(u) && !/^\s*data:image\//i.test(u) ? '#' : u);
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => `<img alt="${a}" src="${safeUrl(u)}">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${safeUrl(u)}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}
const LIST = /^\s*([-*+]|\d+[.)])\s+/;
const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
export function markdownToHtmlString(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], i = 0;
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (/^\s*```/.test(line)) {
      flush();
      const lang = line.trim().slice(3).trim(), buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
    } else if (!line.trim()) { flush(); i++; }
    else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; }
    else if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdownToHtmlString(buf.join('\n'))}</blockquote>`);
    } else if (LIST.test(line)) {
      flush();
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul', items = [];
      while (i < lines.length && LIST.test(lines[i])) items.push(lines[i++].replace(LIST, ''));
      out.push(`<${tag}>${items.map(t => {
        const tm = t.match(/^\[([ xX])\]\s+(.*)$/);
        return tm ? `<li><input type="checkbox" disabled${tm[1] !== ' ' ? ' checked' : ''}> ${inline(tm[2])}</li>` : `<li>${inline(t)}</li>`;
      }).join('')}</${tag}>`);
    } else if (line.includes('|') && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] || '')) {
      flush();
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else { para.push(line.trim()); i++; }
  }
  flush();
  return out.join('\n');
}

export async function markdownToHtml(file) {
  const html = page(baseName(file.name), markdownToHtmlString(await file.text()));
  return [{ name: renameExt(file.name, 'html'), blob: new Blob([html], { type: MIME.html }) }];
}
