// ConvertHub AI layer — 100% local, privacy-first
// - Text intelligence (summaries, translation, key points, tool finder): Ollama  (http://localhost:11434)
// - Speech to text (audio/video → transcript / subtitles):               Whisper ASR webservice (http://localhost:9000)
// Nothing is sent to any cloud API. If a service is down, the matching tools show a friendly notice
// and the rule-based fallbacks keep working.
import fs from 'node:fs';

const cfg = {
  ollamaUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
  model: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
  whisperUrl: (process.env.WHISPER_URL || 'http://127.0.0.1:9000').replace(/\/+$/, ''),
  timeoutMs: (Number(process.env.AI_TIMEOUT_SECONDS) || 180) * 1000,
  maxChars: Number(process.env.AI_MAX_INPUT_CHARS) || 60000,
  numCtx: Number(process.env.OLLAMA_NUM_CTX) || 8192,
};

// ---------- health (cached, refreshed every 60 s) ----------
let health = { llm: false, model: cfg.model, models: [], whisper: false, checkedAt: 0 };
export async function aiHealth(force = false) {
  if (!force && Date.now() - health.checkedAt < 60000) return health;
  const next = { llm: false, model: cfg.model, models: [], whisper: false, checkedAt: Date.now() };
  try {
    const r = await fetch(`${cfg.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      next.models = ((await r.json()).models || []).map(m => m.name);
      // Use the configured model if present, else the first available one
      if (!next.models.includes(cfg.model) && next.models.length) next.model = next.models[0];
      next.llm = next.models.length > 0;
    }
  } catch { /* ollama offline */ }
  try {
    const r = await fetch(`${cfg.whisperUrl}/docs`, { signal: AbortSignal.timeout(3000) });
    next.whisper = r.ok;
  } catch { /* whisper offline */ }
  health = next;
  return health;
}
export const aiConfig = () => ({ ...cfg });

/** Load the model into memory at boot (non-blocking) so the first visitor doesn't wait ~1-2 min on CPU. */
export async function warmUp() {
  const h = await aiHealth(true);
  if (!h.llm) return false;
  try {
    await fetch(`${cfg.ollamaUrl}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: h.model, prompt: 'hi', keep_alive: '2h', options: { num_predict: 1 } }), signal: AbortSignal.timeout(cfg.timeoutMs * 2) });
    console.log(`  ➜ AI:      model "${h.model}" warmed up and kept in memory`);
    return true;
  } catch { return false; }
}

// ---------- Ollama chat ----------
async function chat(messages, { json = false, temperature = 0.2, maxTokens = 1024, numCtx = cfg.numCtx } = {}) {
  const h = await aiHealth();
  if (!h.llm) { const e = new Error('The local AI model (Ollama) is not running.'); e.code = 'NO_LLM'; throw e; }
  const body = {
    model: h.model, messages, stream: false, keep_alive: '2h', // keep the model loaded between requests (CPU load is slow)
    options: { temperature, num_ctx: numCtx, num_predict: maxTokens },
  };
  if (json) body.format = 'json';
  const r = await fetch(`${cfg.ollamaUrl}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!r.ok) { const e = new Error(`AI model error (${r.status})`); e.code = 'LLM_HTTP'; throw e; }
  const data = await r.json();
  return { text: (data.message?.content || '').trim(), model: data.model || h.model, evalCount: data.eval_count, promptCount: data.prompt_eval_count };
}

// ---------- 1. AI tool finder ("I want to make my photo smaller for a passport form") ----------
// Hinglish / Indian-language hints so the small model maps everyday words to tool ids reliably
const HINTS = 'Hints: chhota/kam/size ghatao = compress; photo/tasveer/pic = image; badlo/convert karo = convert; jodo/milao = merge; kaato/alag = split/trim; ghumao = rotate; anuvad/bhasha = translate; saransh = summarize; awaaz/audio/bolna = audio or transcribe; gaana = mp3; chalchitra/video = video; file band karo = zip.';
/**
 * Hybrid finder. A 3B model on CPU is slow + unreliable at choosing between 124 ids, but it is good at
 * understanding Hinglish/Hindi and translating the wish into English keywords. So:
 *   1. LLM (tiny prompt, ~150 tokens): request → {from, to, action, keywords, reply}
 *   2. Server: deterministic scoring of those keywords against the catalog (fast, always valid ids)
 *   3. Fallback: if the LLM is down/garbled we still score the raw query, so the feature degrades gracefully.
 */
export async function findTool(query, tools) {
  const q = String(query || '').trim().slice(0, 500);
  const t0 = Date.now();
  const system = `You help users of ConvertHub, a free Indian file-conversion website. The user writes (in English, Hindi, Hinglish or any Indian language) what they want to do with a file.
Translate the wish into English search terms. Reply ONLY with JSON:
{"from":"<source format like jpg/pdf/mp4 or empty>","to":"<target format or empty>","action":"<one of: convert, compress, resize, merge, split, rotate, trim, extract, summarize, translate, transcribe, subtitles, zip, unzip, ocr, other>","keywords":["3-6 short English words"],"reply":"one friendly sentence in the user's own language saying what you found"}
${HINTS}`;
  let parsed = null, model;
  try {
    const out = await chat([{ role: 'system', content: system }, { role: 'user', content: q }], { json: true, temperature: 0.1, maxTokens: 140, numCtx: 2048 });
    model = out.model;
    parsed = JSON.parse(out.text);
  } catch (e) {
    if (e.code === 'NO_LLM') throw e;
    parsed = null; // garbled JSON → keyword fallback below
  }
  // Weighted terms: the user's OWN words (Latin or Devanagari) count 3x more than the LLM's interpretation,
  // because the small model sometimes hallucinates on non-Latin scripts.
  const terms = new Map();
  const addTerm = (v, w) => { for (const t of String(v || '').toLowerCase().split(/[^a-z0-9]+/)) if (t.length > 1) terms.set(t, Math.max(terms.get(t) || 0, w)); };
  if (parsed) { addTerm(parsed.from, 1); addTerm(parsed.to, 1); addTerm(parsed.action, 1); (Array.isArray(parsed.keywords) ? parsed.keywords : []).forEach(k => addTerm(k, 1)); }
  const dev = devanagariToTerms(q); // Hindi/Marathi script → English terms (works even if the LLM is confused or offline)
  addTerm(q, 3);
  addTerm(dev, 3);
  // Direction: trust the order of formats in the user's own sentence over the LLM's from/to
  const userWords = `${q} ${dev}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const fmts = formatsInOrder(userWords);
  let from = String(parsed?.from || '').toLowerCase(), to = String(parsed?.to || '').toLowerCase();
  if (fmts.length >= 2) { from = fmts[0]; to = fmts[1]; } else if (fmts.length === 1 && !from) from = fmts[0];
  const ids = scoreTools(terms, tools, { from, to, action: String(parsed?.action || '').toLowerCase() }).slice(0, 3);
  return { tools: ids, reply: String(parsed?.reply || '').slice(0, 400), model, duration_ms: Date.now() - t0, terms: [...terms.keys()] };
}

// Common Devanagari (Hindi/Marathi) words → English search terms. Substring match, so inflections work.
const DEV = [['पीडीएफ', 'pdf'], ['पीडीऍफ़', 'pdf'], ['वर्ड', 'docx'], ['एक्सेल', 'xlsx'], ['फोटो', 'image'], ['तस्वीर', 'image'], ['छवि', 'image'], ['चित्र', 'image'], ['वीडियो', 'video'], ['व्हिडिओ', 'video'],
  ['ऑडियो', 'audio'], ['आवाज', 'audio'], ['गाना', 'mp3'], ['गाणे', 'mp3'], ['बदल', 'convert'], ['रूपांतर', 'convert'], ['छोटा', 'compress'], ['छोटी', 'compress'], ['लहान', 'compress'], ['कम', 'compress'], ['जोड़', 'merge'], ['जोड', 'merge'], ['एकत्र', 'merge'],
  ['अलग', 'split'], ['काट', 'trim'], ['घुमा', 'rotate'], ['फिरव', 'rotate'], ['अनुवाद', 'translate'], ['भाषांतर', 'translate'], ['हिंदी', 'translate'], ['मराठी', 'translate'], ['सारांश', 'summarize'], ['सार', 'summarize'],
  ['लिख', 'transcribe'], ['टेक्स्ट', 'txt'], ['मजकूर', 'txt'], ['सबटाइटल', 'subtitles'], ['उपशीर्षक', 'subtitles'], ['ज़िप', 'zip'], ['जिप', 'zip'], ['स्कैन', 'ocr'], ['जेपीजी', 'jpg'], ['पीएनजी', 'png'], ['एमपी3', 'mp3'], ['एमपी4', 'mp4']];
export function devanagariToTerms(s) {
  const hits = [];
  for (const [hi, en] of DEV) { const i = s.indexOf(hi); if (i >= 0) hits.push([i, en]); }
  return hits.sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' '); // keep the order the user wrote them in
}
// Known formats as users name them; order of appearance in the sentence tells us the direction ("pdf ko word me" = pdf → word)
const FORMAT_WORDS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif', 'bmp', 'svg', 'avif', 'tiff', 'ico', 'pdf', 'word', 'docx', 'doc', 'excel', 'xlsx', 'csv', 'json', 'pptx', 'ppt', 'powerpoint', 'txt', 'text', 'html', 'md', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4', 'mkv', 'mov', 'avi', 'webm', 'zip', 'srt', 'image', 'video', 'audio']);
function formatsInOrder(words) { return words.map(w => (w === 'jpeg' ? 'jpg' : w === 'text' ? 'txt' : w === 'powerpoint' ? 'pptx' : w)).filter(w => FORMAT_WORDS.has(w)); }

const SYN = { jpeg: 'jpg', picture: 'image', photo: 'image', pic: 'image', img: 'image', movie: 'video', clip: 'video', song: 'mp3', music: 'audio', voice: 'audio', recording: 'audio', speech: 'transcribe', text: 'txt', word: 'docx', doc: 'docx', excel: 'xlsx', sheet: 'xlsx', powerpoint: 'pptx', ppt: 'pptx', smaller: 'compress', small: 'compress', reduce: 'compress', shrink: 'compress', size: 'compress', combine: 'merge', join: 'merge', cut: 'trim', caption: 'subtitles', subtitle: 'subtitles', summary: 'summarize', translation: 'translate', hindi: 'translate', marathi: 'translate', unzip: 'extract' };
const STOP = new Set(['the', 'a', 'an', 'to', 'in', 'into', 'and', 'or', 'of', 'my', 'me', 'i', 'it', 'is', 'for', 'with', 'file', 'files', 'want', 'need', 'have', 'please', 'this', 'that', 'convert', 'other', 'format']);
function scoreTools(weighted, tools, { from, to, action }) {
  // expand synonyms additively (keep the original word too, e.g. "word" matches pdf-to-word AND docx)
  const terms = new Map();
  for (const [t, w] of weighted) {
    if (STOP.has(t)) continue;
    terms.set(t, Math.max(terms.get(t) || 0, w));
    if (SYN[t]) terms.set(SYN[t], Math.max(terms.get(SYN[t]) || 0, w));
  }
  if (!terms.size) return [];
  const scored = [];
  for (const t of tools) {
    const title = t.title.toLowerCase(), id = t.id.toLowerCase(), hay = `${t.desc} ${t.keywords} ${t.cat}`.toLowerCase();
    let s = 0;
    for (const [w, weight] of terms) {
      if (id.split('-').includes(w)) s += 6 * weight;
      else if (title.includes(w)) s += 4 * weight;
      else if (hay.includes(w)) s += 1.5 * weight;
    }
    if (from && to && id === `${from}-to-${to}`) s += 20;
    if (from && id.startsWith(`${from}-`)) s += 3;
    if (to && id.endsWith(`-to-${to}`)) s += 3;
    if (action && action !== 'convert' && action !== 'other' && (id.includes(action) || hay.includes(action))) s += 5;
    if (s > 0) scored.push([s + (t.popular ? .5 : 0), t.id]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(x => x[1]);
}

// ---------- 2. Text tasks (summarise / translate / key points / simplify / custom) ----------
const LANG_NAMES = { en: 'English', hi: 'Hindi (हिंदी)', mr: 'Marathi (मराठी)', ta: 'Tamil (தமிழ்)', te: 'Telugu (తెలుగు)', gu: 'Gujarati (ગુજરાતી)', bn: 'Bengali (বাংলা)', kn: 'Kannada (ಕನ್ನಡ)', ml: 'Malayalam (മലയാളം)', pa: 'Punjabi (ਪੰਜਾਬੀ)', ur: 'Urdu (اردو)', fr: 'French', de: 'German', es: 'Spanish', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese' };
export const TEXT_TASKS = ['summarize', 'translate', 'keypoints', 'simplify', 'custom'];

function taskPrompt(task, { targetLang = 'en', instruction = '', length = 'medium' } = {}) {
  const lang = LANG_NAMES[targetLang] || targetLang || 'English';
  const len = { short: 'in 3-4 sentences', medium: 'in 2-3 short paragraphs', long: 'in detail with headings' }[length] || 'in 2-3 short paragraphs';
  switch (task) {
    case 'summarize': return `Summarize the following document ${len}. Keep every important name, number, date and decision. Write the summary in ${lang}. Output only the summary.`;
    case 'translate': return `Translate the following text into ${lang}. Preserve formatting, line breaks, numbers and proper nouns. Output only the translation, nothing else.`;
    case 'keypoints': return `Extract the key points of the following document as a bullet list (maximum 12 bullets, each one line). Then add a line "Action items:" with any tasks or deadlines found (or "none"). Write in ${lang}. Output only the list.`;
    case 'simplify': return `Rewrite the following text in very simple, plain ${lang} that a 12-year-old or a first-time reader can understand. Keep all facts. Output only the rewritten text.`;
    default: return `${String(instruction || 'Improve the following text.').slice(0, 1000)}\nRespond in ${lang}. Output only the result.`;
  }
}

/** Split long text on paragraph boundaries so each chunk fits the model's context. */
function chunkText(text, size) {
  const out = [];
  let buf = '';
  for (const para of text.split(/\n{2,}/)) {
    if ((buf + para).length > size && buf) { out.push(buf); buf = ''; }
    if (para.length > size) { for (let i = 0; i < para.length; i += size) out.push(para.slice(i, i + size)); continue; }
    buf += (buf ? '\n\n' : '') + para;
  }
  if (buf) out.push(buf);
  return out;
}

export async function runTextTask(task, text, opts = {}, onProgress = () => {}) {
  if (!TEXT_TASKS.includes(task)) { const e = new Error('Unknown AI task'); e.code = 'BAD_TASK'; throw e; }
  let input = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!input) { const e = new Error('The file contains no readable text.'); e.code = 'EMPTY'; throw e; }
  let truncated = false;
  if (input.length > cfg.maxChars) { input = input.slice(0, cfg.maxChars); truncated = true; }
  const t0 = Date.now();
  const CHUNK = 7000; // ≈ 1,800 tokens — safe for an 8k context with room for the answer
  const chunks = chunkText(input, CHUNK);
  const prompt = taskPrompt(task, opts);
  let model;
  let result;
  if (chunks.length === 1) {
    const r = await chat([{ role: 'system', content: prompt }, { role: 'user', content: chunks[0] }], { maxTokens: task === 'translate' ? 4096 : 1500 });
    result = r.text; model = r.model;
  } else {
    // Map: process each chunk; Reduce: for summaries/keypoints merge the partial results into one
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      onProgress(i / chunks.length, `AI is reading part ${i + 1} of ${chunks.length}…`);
      const r = await chat([{ role: 'system', content: prompt }, { role: 'user', content: chunks[i] }], { maxTokens: task === 'translate' ? 4096 : 900 });
      parts.push(r.text); model = r.model;
    }
    if (task === 'summarize' || task === 'keypoints') {
      onProgress(0.95, 'Combining…');
      const merge = task === 'summarize'
        ? `These are summaries of consecutive parts of ONE document. Merge them into a single coherent summary with no repetition. Keep the same language. Output only the final summary.`
        : `These are key-point lists from consecutive parts of ONE document. Merge them into one deduplicated list (max 15 bullets) followed by "Action items:". Keep the same language. Output only the list.`;
      const r = await chat([{ role: 'system', content: merge }, { role: 'user', content: parts.join('\n\n---\n\n') }], { maxTokens: 1500 });
      result = r.text;
    } else {
      result = parts.join('\n\n');
    }
  }
  if (truncated) result += `\n\n(Note: the document was longer than ${cfg.maxChars.toLocaleString('en-IN')} characters, so only the first part was processed.)`;
  return { result, model, duration_ms: Date.now() - t0, chunks: chunks.length, input_chars: input.length, truncated };
}

// ---------- 3. Speech to text (Whisper) ----------
export const TRANSCRIBE_FORMATS = new Set(['txt', 'srt', 'vtt', 'json', 'tsv']);
export async function transcribe(filePath, originalName, { format = 'txt', language = '', task = 'transcribe' } = {}) {
  const h = await aiHealth();
  if (!h.whisper) { const e = new Error('The local speech-to-text service (Whisper) is not running.'); e.code = 'NO_WHISPER'; throw e; }
  const fmt = TRANSCRIBE_FORMATS.has(format) ? format : 'txt';
  const params = new URLSearchParams({ task: task === 'translate' ? 'translate' : 'transcribe', output: fmt, encode: 'true' });
  if (language && /^[a-z]{2}$/i.test(language)) params.set('language', language.toLowerCase());
  const fd = new FormData();
  fd.append('audio_file', await fs.openAsBlob(filePath), originalName || 'audio');
  const t0 = Date.now();
  const r = await fetch(`${cfg.whisperUrl}/asr?${params}`, { method: 'POST', body: fd, signal: AbortSignal.timeout(cfg.timeoutMs * 3) });
  if (!r.ok) { const e = new Error(`Speech-to-text failed (${r.status}). The file may not contain audio.`); e.code = 'WHISPER_HTTP'; throw e; }
  const text = await r.text();
  return { text, format: fmt, duration_ms: Date.now() - t0 };
}
