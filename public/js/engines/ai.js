// AI engine — talks to the LOCAL AI on the server (Ollama + Whisper). See src/ai.js.
// Text is extracted from PDF / DOCX / TXT right here in the browser, so only plain text is sent — never the file.
import { loadScript, baseName, extOf } from '../utils.js';
import { sid } from '../track.js';

const TXT = 'text/plain;charset=utf-8';
const MD = 'text/markdown;charset=utf-8';

async function postJson(path, body, ctx) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ch-session': sid }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `AI error (${r.status})`); e.code = data.code; throw e; }
  return data;
}

/** Extract readable text from PDF, DOCX, TXT/MD/CSV/HTML/JSON files — all in the browser. */
export async function extractText(file, ctx) {
  const ext = extOf(file.name);
  if (ext === 'pdf') {
    ctx?.log('Reading PDF…');
    await loadScript('/vendor/pdfjs/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    let doc;
    try { doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
    catch (e) { throw new Error(e?.name === 'PasswordException' ? 'This PDF is password-protected. Unlock it first.' : 'Could not read this PDF.'); }
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      for (const it of tc.items) if ('str' in it) text += it.str + (it.hasEOL ? '\n' : ' ');
      text += '\n\n';
      ctx?.progress(0.3 * i / doc.numPages);
    }
    await doc.destroy();
    if (!text.trim()) throw new Error('No text found — this PDF is probably a scanned image. Try "Image to Text (OCR)" first.');
    return text;
  }
  if (ext === 'docx') {
    ctx?.log('Reading Word file…');
    await loadScript('/vendor/mammoth/mammoth.browser.min.js');
    const { value } = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    if (!value.trim()) throw new Error('The Word file contains no text.');
    return value;
  }
  if (ext === 'html' || ext === 'htm') {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
    doc.querySelectorAll('script,style,noscript').forEach(n => n.remove());
    return doc.body?.innerText || doc.body?.textContent || '';
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('Text files over 5 MB are too large for the AI.');
  return file.text();
}

const LANG_LABEL = { en: 'English', hi: 'Hindi', mr: 'Marathi', ta: 'Tamil', te: 'Telugu', gu: 'Gujarati', bn: 'Bengali', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', ur: 'Urdu', fr: 'French', de: 'German', es: 'Spanish', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese' };

/** Shared runner for summarize / translate / keypoints / simplify / custom */
async function textTask(task, file, o, ctx, suffix) {
  const text = await extractText(file, ctx);
  ctx.progress(0.35);
  ctx.log(`AI is working… (${text.length.toLocaleString('en-IN')} characters)`);
  const data = await postJson('/api/ai/text', { task, text, targetLang: o.lang, instruction: o.instruction, length: o.length, conversion_id: ctx.conversionId });
  ctx.progress(1);
  const lang = LANG_LABEL[o.lang] || o.lang || '';
  const name = `${baseName(file.name)}${suffix}${task === 'translate' && lang ? `-${lang.toLowerCase()}` : ''}.${o.format === 'md' ? 'md' : 'txt'}`;
  const header = o.format === 'md' ? `# ${baseName(file.name)} — ${suffix.replace(/^-/, '')}\n\n` : '';
  const body = header + data.result + '\n';
  return [{ name, blob: new Blob([body], { type: o.format === 'md' ? MD : TXT }), text: data.result, info: `${(data.duration_ms / 1000).toFixed(1)}s · ${data.model}${data.chunks > 1 ? ` · ${data.chunks} parts` : ''}` }];
}
export const summarize = (f, o, ctx) => textTask('summarize', f, o, ctx, '-summary');
export const translateDoc = (f, o, ctx) => textTask('translate', f, o, ctx, '-translated');
export const keyPoints = (f, o, ctx) => textTask('keypoints', f, o, ctx, '-key-points');
export const simplify = (f, o, ctx) => textTask('simplify', f, o, ctx, '-simple');
export const customPrompt = (f, o, ctx) => textTask('custom', f, o, ctx, '-ai');

/** Audio / video → transcript or subtitles via Whisper (file is uploaded to YOUR server only, deleted after). */
export function transcribe(file, o, ctx) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('format', o.format || 'txt');
    fd.append('language', o.lang === 'auto' ? '' : (o.lang || ''));
    fd.append('task', o.task || 'transcribe');
    if (ctx.conversionId) fd.append('conversion_id', String(ctx.conversionId));
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/ai/transcribe');
    xhr.setRequestHeader('x-ch-session', sid);
    xhr.upload.onprogress = e => { if (e.lengthComputable) { ctx.log('Uploading to your server…'); ctx.progress(0.4 * e.loaded / e.total); } };
    xhr.upload.onload = () => { ctx.log('AI is listening… (this can take a while for long files)'); ctx.progress(0.45); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status !== 200) { const e = new Error(data.error || `Server error (${xhr.status})`); e.code = data.code; return reject(e); }
      ctx.progress(1);
      const fmt = data.format || 'txt';
      const mime = fmt === 'srt' ? 'application/x-subrip' : fmt === 'vtt' ? 'text/vtt' : fmt === 'json' ? 'application/json' : TXT;
      resolve([{ name: `${baseName(file.name)}${o.task === 'translate' ? '-english' : ''}.${fmt}`, blob: new Blob([data.text], { type: mime }), text: fmt === 'json' ? undefined : data.text, info: `${(data.duration_ms / 1000).toFixed(1)}s · Whisper` }]);
    };
    xhr.onerror = () => reject(Object.assign(new Error('Could not reach the server.'), { code: 'NETWORK' }));
    xhr.send(fd);
  });
}
