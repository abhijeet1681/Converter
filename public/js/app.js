// ConvertHub single-page app: routing, pages, upload queue, options, results, AI finder, palette, tracking
import { CATEGORIES, TOOLS, TOOL_MAP, SITE_NAME } from './tools.js';
import { h, $, svgUse, formatBytes, extOf, toast, downloadBlob } from './utils.js';
import { track, fileMeta, historyAdd, historyList, historyClear, sid } from './track.js';

const CAT = new Map(CATEGORIES.map(c => [c.id, c]));
const main = $('#main');
let cleanups = [];
let busy = false;
let healthPromise = null;
const health = () => (healthPromise ||= fetch('/api/health').then(r => (r.ok ? r.json() : { office: false, ai: {} })).catch(() => ({ office: false, ai: {} })));
const fmtNum = n => Number(n || 0).toLocaleString('en-IN');

// ---------------------------------------------------------------- favorites (device only)
const favs = new Set((() => { try { return JSON.parse(localStorage.getItem('ch-favs') || '[]'); } catch { return []; } })());
const saveFavs = () => { try { localStorage.setItem('ch-favs', JSON.stringify([...favs])); } catch { /* ignore */ } };

// ---------------------------------------------------------------- routing
function navigate(url) {
  if (busy && !confirm('A conversion is still running. Leave this page?')) return;
  history.pushState({}, '', url);
  render();
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', render);
window.addEventListener('beforeunload', e => { if (busy) { e.preventDefault(); e.returnValue = ''; } });

function render() {
  cleanups.forEach(fn => fn());
  cleanups = [];
  busy = false;
  main.replaceChildren();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  document.querySelectorAll('.main-nav a').forEach(a => a.toggleAttribute('aria-current', path.startsWith(a.getAttribute('href')) ||
    (path.startsWith('/tools/') && TOOL_MAP.get(path.slice(7))?.cat === a.getAttribute('href').split('/').pop())));
  let m;
  let toolId = null, category = null;
  if (path === '/') homeView();
  else if ((m = path.match(/^\/tools\/([\w-]+)$/)) && TOOL_MAP.has(m[1])) { const t = TOOL_MAP.get(m[1]); toolId = t.id; category = t.cat; toolView(t); }
  else if ((m = path.match(/^\/category\/([\w-]+)$/)) && CAT.has(m[1])) { category = m[1]; categoryView(CAT.get(m[1])); }
  else if (path === '/privacy' || path === '/about') pageView(path.slice(1));
  else if (path === '/history') historyView();
  else if (path === '/admin') adminView();
  else notFoundView();
  if (path !== '/admin') track.view(path, toolId, category);
  observeReveals();
}
function setMeta(title, desc) {
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
}
function observeReveals() {
  const els = main.querySelectorAll('.reveal');
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) return els.forEach(e => e.classList.add('in'));
  const io = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .12 });
  els.forEach(e => io.observe(e));
  cleanups.push(() => io.disconnect());
}

// ---------------------------------------------------------------- search
function searchTools(raw) {
  const q = raw.toLowerCase().trim();
  const terms = q.replace(/\bto\b|→|>/g, ' ').split(/\s+/).filter(Boolean);
  const scored = [];
  for (const t of TOOLS) {
    const hay = `${t.title} ${t.id} ${t.desc} ${t.keywords} ${CAT.get(t.cat).name}`.toLowerCase();
    if (!terms.every(w => hay.includes(w))) continue;
    const title = t.title.toLowerCase();
    let s = 0;
    if (t.id === q.replace(/\s+/g, '-')) s += 100;
    if (title === q) s += 50;
    if (title.startsWith(q)) s += 20;
    if (title.includes(q)) s += 10;
    terms.forEach((w, i) => { if (title.includes(w)) s += 3; if (i === 0 && title.startsWith(w)) s += 5; });
    if (t.popular) s += 1;
    if (favs.has(t.id)) s += 2;
    scored.push([s, t]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(x => x[1]);
}
let searchTimer;
const logSearch = (q, source, n, picked) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => q.trim().length > 1 && track.search(q.trim(), source, n, picked), picked ? 0 : 900); };

/** Which tools make sense for a given file? (used by Smart Drop and the palette) */
function toolsForFile(file) {
  const ok = TOOLS.filter(t => accepts(t, file) && t.accept !== '*');
  const ext = extOf(file.name);
  return ok.sort((a, b) => (b.popular - a.popular) || (b.accept.includes(`.${ext}`) - a.accept.includes(`.${ext}`))).slice(0, 8);
}

// ---------------------------------------------------------------- AI finder + command palette
async function askAi(query) {
  const r = await fetch('/api/ai/find-tool', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ch-session': sid }, body: JSON.stringify({ query }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'AI unavailable'), { code: data.code });
  return data;
}
let paletteOpen = false;
function openPalette(initial = '', aiMode = false) {
  if (paletteOpen) return;
  paletteOpen = true;
  const input = h('input', { type: 'text', placeholder: aiMode ? 'Describe what you need… e.g. “photo ko 100 KB se chhota karna hai”' : 'Search tools or describe what you want to do…', value: initial, 'aria-label': 'Search' });
  const list = h('ul');
  const aiReply = h('div', { class: 'ai-reply', hidden: true });
  const hint = h('div', { class: 'hint' }, h('span', null, h('span', { class: 'kbd' }, '↑↓'), ' navigate'), h('span', null, h('span', { class: 'kbd' }, '↵'), ' open'), h('span', null, h('span', { class: 'kbd' }, 'Tab'), ' ask AI'), h('span', null, h('span', { class: 'kbd' }, 'Esc'), ' close'));
  const box = h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Command palette' }, input, aiReply, list, hint);
  const bg = h('div', { class: 'palette-bg' }, box);
  let results = [], sel = 0;
  const close = () => { bg.remove(); paletteOpen = false; document.removeEventListener('keydown', onKey); };
  const go = t => { logSearch(input.value, 'palette', results.length, t.id); close(); navigate(`/tools/${t.id}`); };
  const draw = () => {
    const q = input.value.trim();
    results = q ? searchTools(q).slice(0, 8) : [...TOOLS.filter(t => favs.has(t.id)), ...TOOLS.filter(t => t.popular && !favs.has(t.id))].slice(0, 8);
    sel = 0;
    aiReply.hidden = true;
    list.replaceChildren(
      ...results.map((t, i) => h('li', null, h('a', { href: `/tools/${t.id}`, class: i === 0 ? 'sel' : '', onclick: e => { e.preventDefault(); go(t); } }, CAT.get(t.cat).icon, ' ', t.title, favs.has(t.id) ? ' ★' : ''))),
      q ? h('li', null, h('button', { type: 'button', onclick: () => runAi(q) }, '✨ ', `Ask AI: “${q.slice(0, 60)}”`)) : null,
      !results.length && !q ? h('li', { class: 'ai-row' }, 'Start typing…') : null);
    if (q) logSearch(q, 'palette', results.length);
  };
  async function runAi(q) {
    list.replaceChildren(h('li', { class: 'ai-row' }, h('span', { class: 'spinner', style: 'width:18px;height:18px;border-width:2px' }), 'AI is thinking…'));
    try {
      const data = await askAi(q);
      results = data.tools.map(t => TOOL_MAP.get(t.id)).filter(Boolean);
      sel = 0;
      aiReply.hidden = !data.reply; aiReply.textContent = data.reply ? `✨ ${data.reply}` : '';
      list.replaceChildren(...(results.length ? results.map((t, i) => h('li', null, h('a', { href: `/tools/${t.id}`, class: i === 0 ? 'sel' : '', onclick: e => { e.preventDefault(); go(t); } }, CAT.get(t.cat).icon, ' ', t.title, h('small', { class: 'muted', style: 'margin-left:auto' }, t.desc.slice(0, 50) + '…'))))
        : [h('li', { class: 'ai-row' }, 'No matching tool found. Try different words.')]));
    } catch (e) {
      list.replaceChildren(h('li', { class: 'ai-row' }, e.code === 'NO_LLM' ? '✨ AI assistant is offline right now (Ollama not running). Use the normal search above.' : `AI error: ${e.message}`));
    }
  }
  const onKey = e => {
    if (e.key === 'Escape') return close();
    if (e.key === 'Tab' && input.value.trim()) { e.preventDefault(); return runAi(input.value.trim()); }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length) {
      e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      list.querySelectorAll('a').forEach((a, i) => a.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter') { e.preventDefault(); if (results[sel]) go(results[sel]); else if (input.value.trim()) runAi(input.value.trim()); }
  };
  input.addEventListener('input', draw);
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(bg);
  input.focus();
  if (aiMode && initial.trim()) runAi(initial.trim()); else draw();
  track.event('palette_open', null, { ai: aiMode });
}

// ---------------------------------------------------------------- header
function initHeader() {
  const input = $('#global-search');
  const list = $('#search-results');
  let results = [], sel = 0;
  const close = () => { list.hidden = true; };
  const draw = () => {
    if (!input.value.trim()) return close();
    results = searchTools(input.value).slice(0, 8);
    sel = 0;
    list.replaceChildren(...(results.length
      ? results.map((t, i) => h('li', null, h('a', { href: `/tools/${t.id}`, 'data-link': '', class: i === sel ? 'sel' : '', onclick: () => logSearch(input.value, 'header', results.length, t.id) }, `${CAT.get(t.cat).icon}  ${t.title}`)))
      : [h('li', { class: 'none' }, 'No tools found — press Tab to ask the AI')]));
    list.hidden = false;
    logSearch(input.value, 'header', results.length);
  };
  input.addEventListener('input', draw);
  input.addEventListener('focus', draw);
  input.addEventListener('keydown', e => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length) {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      list.querySelectorAll('a').forEach((a, i) => a.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter' && results[sel]) {
      e.preventDefault(); logSearch(input.value, 'header', results.length, results[sel].id); input.value = ''; close(); input.blur(); navigate(`/tools/${results[sel].id}`);
    } else if (e.key === 'Tab' && input.value.trim()) { e.preventDefault(); const q = input.value; input.value = ''; close(); input.blur(); openPalette(q, true); }
    else if (e.key === 'Escape') { close(); input.blur(); }
  });
  list.addEventListener('click', () => { input.value = ''; close(); });
  document.addEventListener('click', e => { if (!e.target.closest('.header-search')) close(); });
  document.addEventListener('keydown', e => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); input.focus(); }
  });
  $('#theme-toggle').addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#090a14' : '#f4f5fd');
    try { localStorage.setItem('ch-theme', t); } catch { /* private mode */ }
    track.event('theme_change', null, { theme: t });
  });
  const y = $('#year'); if (y) y.textContent = new Date().getFullYear();
  // 3D tilt + spotlight on any .tilt card (one delegated listener, cheap)
  document.addEventListener('pointermove', e => {
    const el = e.target.closest?.('.tilt'); if (!el) return;
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${(x - .5) * 10}deg`); el.style.setProperty('--rx', `${(.5 - y) * 8}deg`);
    el.style.setProperty('--mx', `${x * 100}%`); el.style.setProperty('--my', `${y * 100}%`);
  }, { passive: true });
  const prog = h('div', { class: 'scroll-progress', 'aria-hidden': 'true' }); document.body.append(prog);
  window.addEventListener('scroll', () => { const d = document.documentElement; prog.style.width = `${100 * d.scrollTop / Math.max(1, d.scrollHeight - d.clientHeight)}%`; }, { passive: true });
  const top = $('#to-top');
  window.addEventListener('scroll', () => top.classList.toggle('show', scrollY > 600), { passive: true });
  top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// ---------------------------------------------------------------- shared UI
function toolCard(t) {
  const fav = h('button', { class: `fav${favs.has(t.id) ? ' on' : ''}`, type: 'button', title: 'Favourite', 'aria-label': 'Toggle favourite', onclick: e => {
    e.preventDefault(); e.stopPropagation();
    favs.has(t.id) ? favs.delete(t.id) : favs.add(t.id); saveFavs(); fav.classList.toggle('on', favs.has(t.id)); fav.textContent = favs.has(t.id) ? '★' : '☆';
    track.event(favs.has(t.id) ? 'fav_add' : 'fav_remove', t.id);
  } }, favs.has(t.id) ? '★' : '☆');
  return h('a', { class: 'tool-card tilt', 'data-cat': t.cat, href: `/tools/${t.id}`, 'data-link': '' },
    h('span', { class: 'tool-icon' }, CAT.get(t.cat).icon),
    h('span', { class: 'tool-body' }, h('strong', null, t.title), h('small', null, t.desc)),
    t.ai ? h('span', { class: 'tag ai' }, '✨ AI') : t.server ? h('span', { class: 'tag', title: 'Processed on the server' }, 'Server') : trending.has(t.id) ? h('span', { class: 'tag hot' }, '🔥 Trending') : null,
    fav);
}
const trending = new Set();
const section = (title, sub, ...kids) => h('section', { class: 'section reveal' }, h('div', { class: 'container' }, title ? h('h2', null, title) : null, sub ? h('p', { class: 'muted' }, sub) : null, ...kids));
const sectionEyebrow = (eyebrow, title, sub, ...kids) => h('section', { class: 'section reveal' }, h('div', { class: 'container' }, h('span', { class: 'eyebrow' }, eyebrow), h('h2', null, title), sub ? h('p', { class: 'muted' }, sub) : null, ...kids));

function featuresSection() {
  const f = [
    ['🔒', 'Private by design', 'Images, PDFs, spreadsheets, audio and video are converted inside your browser. Your files are never uploaded.'],
    ['⚡', 'Native-speed engines', 'Powered by FFmpeg and other battle-tested engines compiled to WebAssembly.'],
    ['✨', 'AI that stays home', 'Summaries, translations into Indian languages and speech-to-text run on our own server — never a third-party cloud.'],
    ['📦', 'Batch conversion', 'Drop dozens of files at once and download everything as a single ZIP.'],
    ['🎛️', 'Pro options', 'Control quality, resolution, bitrate, page ranges, trimming and more.'],
    ['📱', 'Works everywhere', 'Windows, Mac, Linux, Android and iPhone — any modern browser. Even on 2G.'],
  ];
  return sectionEyebrow('Why ConvertHub', 'Everything you need from a file converter', 'And nothing you don’t.',
    h('div', { class: 'features stagger' }, ...f.map(([i, t, d]) => h('div', { class: 'feature' }, h('div', { class: 'fi' }, i), h('h3', null, t), h('p', null, d)))));
}
function faqSection() {
  const q = [
    ['Is ' + SITE_NAME + ' really free?', 'Yes. Every tool is free to use with no sign-up and no watermarks.'],
    ['Are my files uploaded to a server?', 'Almost never. Image, PDF, spreadsheet, audio, video and archive tools run 100% in your browser. Only tools marked “Server” or “AI” send data to our own server; it is processed and deleted immediately.'],
    ['What does the AI do with my document?', 'Text is extracted on your device and sent to an AI model running on this very server (Ollama / Whisper). It is never sent to OpenAI, Google or any other company and is not stored.'],
    ['Is there a file size limit?', 'Browser tools are limited only by your device memory (videos up to roughly 1–2 GB work on most computers). Server tools have a limit set by the site owner.'],
    ['Why is the first video conversion slower?', 'The FFmpeg engine (~30 MB) is downloaded once and then cached by your browser. Later conversions start instantly.'],
    ['Which browsers are supported?', 'The latest versions of Chrome, Edge, Firefox, Safari, Brave and Opera on desktop and mobile.'],
  ];
  return section('Frequently asked questions', null, h('div', { class: 'faq' }, ...q.map(([a, b]) => h('details', null, h('summary', null, a), h('p', null, b)))));
}

// ---------------------------------------------------------------- pages
function homeView() {
  setMeta(`${SITE_NAME} — Free All-in-One File Converter (Image, PDF, Video, Audio, Excel, AI)`, `Convert images, PDFs, documents, spreadsheets, audio and video for free with ${TOOLS.length}+ private tools. Plus AI summaries, translation and speech-to-text.`);
  const search = h('input', { type: 'search', class: 'big-search', placeholder: `Search ${TOOLS.length}+ tools… “heic to jpg”, “merge pdf”, “hindi translate”`, 'aria-label': 'Search tools' });
  const aiBtn = h('button', { class: 'ai-ask', type: 'button', onclick: () => openPalette(search.value, true) }, '✨ Ask AI');
  const grid = h('div', { class: 'tool-grid stagger' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const trendRow = h('div', { class: 'trend', hidden: true });
  let active = favs.size ? 'favs' : 'popular';
  const draw = () => {
    const q = search.value.trim();
    const list = q ? searchTools(q) : active === 'popular' ? TOOLS.filter(t => t.popular) : active === 'favs' ? TOOLS.filter(t => favs.has(t.id)) : active === 'all' ? TOOLS : TOOLS.filter(t => t.cat === active);
    grid.replaceChildren(...(list.length ? list.map(toolCard) : [h('p', { class: 'empty' }, active === 'favs' && !q ? 'No favourites yet — click ☆ on any tool to save it here.' : 'No tools match your search. Try a format name like “png” or “mp4”, or click ✨ Ask AI.')]));
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', !q && b.dataset.id === active));
    if (q) logSearch(q, 'hero', list.length);
  };
  [{ id: 'popular', name: '⭐ Popular' }, { id: 'favs', name: `★ My favourites${favs.size ? ` (${favs.size})` : ''}` }, { id: 'all', name: `All (${TOOLS.length})` }, ...CATEGORIES.map(c => ({ id: c.id, name: `${c.icon} ${c.name}` }))]
    .forEach(d => tabs.append(h('button', { type: 'button', 'data-id': d.id, onclick: () => { active = d.id; search.value = ''; draw(); } }, d.name)));
  search.addEventListener('input', draw);
  search.addEventListener('keydown', e => { if (e.key === 'Enter') { const r = searchTools(search.value)[0]; if (r) { logSearch(search.value, 'hero', 1, r.id); navigate(`/tools/${r.id}`); } else if (search.value.trim()) openPalette(search.value, true); } });

  // rotating headline
  const words = ['any file', 'PDF', 'photos', 'videos', 'Word docs', 'Excel sheets', 'audio', 'with AI'];
  const rot = h('span', { class: 'rotator' }, ...words.map((w, i) => h('span', { class: i === 0 ? 'on' : '' }, w)));
  let ri = 0;
  const rt = setInterval(() => { const s = rot.children; s[ri].classList.remove('on'); ri = (ri + 1) % s.length; s[ri].classList.add('on'); }, 2200);
  cleanups.push(() => clearInterval(rt));

  // live counters from the database
  const stats = h('div', { class: 'hero-stats' },
    statBox(`${TOOLS.length}+`, 'free tools'), statBox('0', 'files converted', 'conv'), statBox('0 MB', 'processed', 'mb'), statBox('₹0', 'forever'));
  fetch('/api/stats').then(r => r.json()).then(s => {
    countUp(stats.querySelector('[data-k="conv"] b'), s.conversions);
    stats.querySelector('[data-k="mb"] b').textContent = s.bytes > 1e9 ? `${(s.bytes / 1e9).toFixed(1)} GB` : `${Math.round(s.bytes / 1e6)} MB`;
    (s.trending || []).forEach(id => trending.add(id));
    if (trending.size) {
      draw();
      const hot = [...trending].map(id => TOOL_MAP.get(id)).filter(Boolean).slice(0, 8);
      if (hot.length) { trendRow.hidden = false; trendRow.replaceChildren(h('span', { class: 'tl' }, '🔥 Trending now'), ...hot.map(t => h('a', { href: `/tools/${t.id}`, 'data-link': '' }, `${CAT.get(t.cat).icon} ${t.title}`))); }
    }
  }).catch(() => {});

  // quick convert — the conversions people search for most, as FROM → TO tiles
  const QUICK = [['jpg-to-png', 'JPG', 'PNG'], ['png-to-jpg', 'PNG', 'JPG'], ['heic-to-jpg', 'HEIC', 'JPG'], ['pdf-to-jpg', 'PDF', 'JPG'], ['jpg-to-pdf', 'JPG', 'PDF'],
    ['pdf-to-word', 'PDF', 'DOCX'], ['word-to-pdf', 'DOCX', 'PDF'], ['excel-to-csv', 'XLSX', 'CSV'], ['csv-to-excel', 'CSV', 'XLSX'], ['video-to-mp3', 'MP4', 'MP3'],
    ['mp4-to-gif', 'MP4', 'GIF'], ['mov-to-mp4', 'MOV', 'MP4'], ['compress-pdf', '🗜️'], ['merge-pdf', '🧩'], ['compress-image', '📉'], ['ai-translate', '🌐']];
  const quickGrid = h('div', { class: 'quick-grid stagger' }, ...QUICK.map(([id, from, to]) => {
    const t = TOOL_MAP.get(id); if (!t) return null;
    const c = CAT.get(t.cat);
    return h('a', { class: 'quick tilt', 'data-cat': t.cat, href: `/tools/${t.id}`, 'data-link': '', title: t.desc },
      to ? h('span', { class: 'pair' }, h('span', { class: 'ext' }, from), h('span', { class: 'arrow' }, '→'), h('span', { class: 'ext to' }, to)) : h('span', { class: 'verb' }, from),
      h('span', { class: 'ql' }, to ? `${from} to ${to}` : t.title),
      h('small', null, `${c.icon} ${c.name}`));
  }));

  // smart drop — drop any file, we suggest the right tools
  const sdInput = h('input', { type: 'file', hidden: true });
  const sdResult = h('div', { class: 'smart-result', hidden: true });
  const smart = h('div', { class: 'smart-drop', tabindex: '0', role: 'button', 'aria-label': 'Drop any file to get tool suggestions' },
    h('span', { class: 'sd-icon' }, '🪄'), h('h3', null, 'Not sure which tool? Drop any file here'), h('p', null, 'We’ll detect the type and show you what you can do with it. Nothing is uploaded.'), sdInput, sdResult);
  const suggest = file => {
    const list = toolsForFile(file);
    sdResult.hidden = false;
    sdResult.replaceChildren(
      h('div', { class: 'file' }, h('span', { class: 'ext-badge', style: 'width:36px;height:36px' }, (extOf(file.name) || 'file').slice(0, 4)), h('span', null, h('b', null, file.name), ` · ${formatBytes(file.size)}`)),
      list.length ? h('div', { class: 'choices' }, ...list.map(t => h('button', { type: 'button', onclick: e => { e.stopPropagation(); pendingFile = file; track.event('smartdrop_pick', t.id, { ext: extOf(file.name) }); navigate(`/tools/${t.id}`); } }, `${CAT.get(t.cat).icon} ${t.title}`, h('small', null, t.desc.slice(0, 60) + '…'))))
        : h('p', { class: 'muted' }, 'Hmm, we don’t have a tool for this file type yet. Try “Create ZIP” or ask the AI.'));
    track.search(extOf(file.name) || file.type || 'unknown', 'smartdrop', list.length);
  };
  smart.addEventListener('click', e => { if (!e.target.closest('.smart-result') && e.target !== sdInput) sdInput.click(); });
  smart.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sdInput.click(); } });
  sdInput.addEventListener('change', () => { if (sdInput.files[0]) suggest(sdInput.files[0]); sdInput.value = ''; });
  const onDragOver = e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); smart.classList.add('over'); } };
  const onDragLeave = () => smart.classList.remove('over');
  const onDrop = e => { e.preventDefault(); smart.classList.remove('over'); if (e.dataTransfer?.files?.[0]) suggest(e.dataTransfer.files[0]); };
  window.addEventListener('dragover', onDragOver); window.addEventListener('dragleave', onDragLeave); window.addEventListener('drop', onDrop);
  cleanups.push(() => { window.removeEventListener('dragover', onDragOver); window.removeEventListener('dragleave', onDragLeave); window.removeEventListener('drop', onDrop); });

  // floating file icons behind the hero
  const FL = [['🖼️', 'JPG', 4, 14], ['📕', 'PDF', 78, 10], ['🎬', 'MP4', 88, 52], ['📊', 'XLSX', 8, 60], ['🎵', 'MP3', 92, 26], ['📝', 'DOCX', 14, 36], ['✨', 'AI', 84, 72], ['🧰', 'ZIP', 3, 82]];
  const floaters = h('div', { class: 'floaters', 'aria-hidden': 'true' }, ...FL.map(([ic, l, x, y], i) => { const sp = h('span', { 'data-l': l }, ic); sp.style.cssText = `left:${x}%;top:${y}%;--dur:${11 + i * 1.7}s;--dx:${(i % 2 ? -1 : 1) * (14 + i * 3)}px;--dy:${-(18 + i * 4)}px;animation-delay:${-i * 2.3}s`; return sp; }));

  // live activity ticker (anonymous: tool + format + time ago, from the DB)
  const tickMsg = h('span', { class: 'msg' });
  const ticker = h('div', { class: 'ticker', hidden: true }, h('span', { class: 'live' }, h('i'), 'LIVE'), tickMsg);
  const ago = iso => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  fetch('/api/activity').then(r => r.json()).then(list => {
    if (!list.length) return;
    ticker.hidden = false;
    tickMsg.replaceChildren(...list.map((a, i) => h('span', { class: i === 0 ? 'on' : '' }, 'Someone used ', h('b', null, a.tool), a.from && a.to ? ` (${a.from} → ${a.to})` : '', ` · ${ago(a.at)}`)));
    if (list.length > 1) { let ti = 0; const tt = setInterval(() => { const c = tickMsg.children; c[ti].classList.remove('on'); ti = (ti + 1) % c.length; c[ti].classList.add('on'); }, 3400); cleanups.push(() => clearInterval(tt)); }
  }).catch(() => {});

  const formats = ['JPG', 'PNG', 'WEBP', 'HEIC', 'SVG', 'AVIF', 'GIF', 'PDF', 'DOCX', 'PPTX', 'XLSX', 'CSV', 'JSON', 'MP3', 'WAV', 'M4A', 'FLAC', 'MP4', 'MKV', 'MOV', 'WEBM', 'ZIP', 'SRT', 'TXT', 'MD', 'HTML', 'ODT', 'TIFF', 'ICO', 'BMP'];
  const marquee = h('div', { class: 'marquee', 'aria-hidden': 'true' }, h('div', { class: 'marquee-track' }, ...[...formats, ...formats].map(f => h('span', { class: 'fmt' }, f))));

  const toolsSection = section(null, null, trendRow, tabs, grid);
  toolsSection.classList.add('tools-home');
  const showAll = () => { active = 'all'; search.value = ''; draw(); toolsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  main.append(
    h('section', { class: 'hero' }, floaters, h('div', { class: 'container' },
      h('span', { class: 'hero-badge' }, h('span', { class: 'dot' }), '100% private · Files never leave your device · Made in India ', svgUse('flag-in', 'flag', 'Flag of India')),
      h('h1', null, 'Convert ', rot, h('br'), h('span', { class: 'ul' }, 'in seconds.')),
      h('p', { class: 'lead' }, `${TOOLS.length}+ free tools for images, PDFs, documents, spreadsheets, audio and video — plus private AI that summarises, translates into Indian languages and converts speech to text.`),
      h('div', { class: 'hero-search-wrap' }, search, aiBtn),
      h('div', { class: 'hero-chips' }, ...[['heic-to-jpg', 'HEIC → JPG'], ['compress-pdf', 'Compress PDF'], ['merge-pdf', 'Merge PDF'], ['video-to-mp3', 'Video → MP3'], ['ai-translate', '✨ Translate to Hindi'], ['ai-transcribe', '✨ Audio → Text']]
        .map(([id, l]) => h('button', { class: 'chip', type: 'button', onclick: () => navigate(`/tools/${id}`) }, l))),
      smart, stats, ticker, marquee)),
    sectionEyebrow('Quick convert', 'Most popular conversions', 'One click, no sign-up, no watermark. Pick a pair and drop your file.', quickGrid),
    toolsSection,
    sectionEyebrow('Browse', 'Tools by category', null, h('div', { class: 'cat-grid stagger' }, ...CATEGORIES.map(c => {
      const inCat = TOOLS.filter(t => t.cat === c.id);
      const best = inCat.filter(t => t.popular).slice(0, 3);
      return h('a', { class: 'cat-card tilt', 'data-cat': c.id, href: `/category/${c.id}`, 'data-link': '' },
        h('div', { class: 'ci' }, c.icon), h('h3', null, c.name), h('p', null, c.desc),
        best.length ? h('div', { class: 'mini' }, ...best.map(t => h('span', null, t.title))) : null,
        h('span', { class: 'count' }, `${inCat.length} tools →`));
    }))),
    sectionEyebrow('Simple', 'How it works', null, h('div', { class: 'steps stagger' },
      h('div', null, h('h3', null, 'Choose a tool'), h('p', null, 'Search, browse, drop a file on the magic box, or just describe what you want to the AI.')),
      h('div', null, h('h3', null, 'Add your files'), h('p', null, 'Drag & drop, click to browse or paste. Tweak the options if you like.')),
      h('div', null, h('h3', null, 'Download'), h('p', null, 'Conversion happens instantly on your device. Download files one by one or as a ZIP.')))),
    featuresSection(),
    faqSection(),
    section(null, null, h('div', { class: 'cta-banner' },
      h('span', { class: 'eyebrow' }, 'Ready when you are'),
      h('h2', null, 'Your files, converted in seconds — ', h('span', { class: 'grad' }, 'free forever'), '.'),
      h('p', null, 'No sign-up, no watermark, and for most tools no upload at all. Drop a file and see for yourself.'),
      h('div', { class: 'cta-actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: showAll }, `Browse all ${TOOLS.length} tools`),
        h('button', { class: 'btn saffron big', type: 'button', onclick: () => openPalette('', true) }, '✨ Ask the AI')),
      h('div', { class: 'trust' }, h('span', null, '🔒 Private by design'), h('span', null, '⚡ Instant, in your browser'), h('span', null, '₹0 · No ads'), h('span', null, 'Made in India ', svgUse('flag-in', 'flag'))))),
  );
  draw();
}
function statBox(v, l, k) { return h('div', { class: 'stat', 'data-k': k || null }, h('b', null, v), h('span', null, l)); }
function countUp(el, target) {
  if (!el) return; target = Number(target) || 0;
  const t0 = performance.now(), dur = 1400;
  const step = now => { const p = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - p, 3); el.textContent = fmtNum(Math.round(target * e)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
let pendingFile = null; // file carried from Smart Drop to the tool page

function categoryView(cat) {
  const list = TOOLS.filter(t => t.cat === cat.id);
  setMeta(`${cat.name} Converters & Tools — ${SITE_NAME}`, cat.desc);
  main.append(
    h('section', { class: 'hero' }, h('div', { class: 'container' },
      h('div', { class: 'breadcrumb', style: 'justify-content:center' }, h('a', { href: '/', 'data-link': '' }, 'Home'), '›', h('span', null, cat.name)),
      h('h1', null, cat.icon, ' ', h('span', { class: 'grad' }, cat.name), ' tools'),
      h('p', { class: 'lead' }, cat.desc))),
    section(`${list.length} tools`, null, h('div', { class: 'tool-grid stagger' }, ...list.map(toolCard))),
  );
  if (cat.id === 'ai') health().then(s => { if (!s.ai?.llm && !s.ai?.whisper) main.querySelector('.hero .container').append(h('div', { class: 'notice' }, '⚠️ The AI services (Ollama / Whisper) are not running on this server right now. These tools will work as soon as they are started — see README.')); });
}

function pageView(which) {
  const pages = {
    privacy: ['Privacy Policy', [
      `${SITE_NAME} is built to be private by default.`,
      'Browser tools (images, PDF, spreadsheets, audio, video, archives, Base64 and checksums) process files entirely on your device using WebAssembly and JavaScript. These files are never sent to our server.',
      'Office tools marked “Server” upload the file over an encrypted connection, convert it with LibreOffice and delete both the input and output immediately after the download.',
      'AI tools: for documents, the text is extracted on your device and only that text is sent to an AI model running on our own server (Ollama). For audio/video transcription the media file is uploaded to our own server (Whisper) and deleted immediately after. Nothing is ever sent to OpenAI, Google or any third-party AI company, and the content is not stored.',
      'What we record: anonymous usage statistics — a random browser ID, which tool was used, file names, sizes and types, timings and errors — so we can improve the service. We never store file contents, your IP address (only a one-way hash) or any account information, because there are no accounts.',
      'Your theme, favourites and conversion history are saved in your browser’s local storage only. No advertising or tracking cookies are used.',
    ], 'archive'],
    about: [`About ${SITE_NAME}`, [
      `${SITE_NAME} is an all-in-one file converter with ${TOOLS.length}+ tools for images, PDFs, documents, spreadsheets, audio, video, archives — and private AI.`,
      'Unlike most converters, it does the heavy lifting inside your browser with WebAssembly versions of FFmpeg, PDF.js, pdf-lib and SheetJS — so it is fast, works on any device and keeps your files private.',
      'The AI features (summaries, translation into Hindi, Marathi, Tamil, Telugu, Gujarati, Bengali and more, key points, speech-to-text and subtitles) run on open-source models hosted on our own server, so your documents never leave it.',
      'Built with ❤️ in India for students, offices, shops and everyone who just needs a file in a different format — fast, free and without the ads.',
    ]],
  };
  const [title, paras, extra] = pages[which];
  setMeta(`${title} — ${SITE_NAME}`, paras[0]);
  const box = h('div', { class: 'container prose' }, h('h1', null, title), ...paras.map(p => h('p', null, p)));
  if (extra === 'archive') health().then(s => { if (s.archive?.enabled) box.append(h('p', null, h('b', null, 'File archive: '), `the site owner has enabled an archive. A copy of the files you convert (input and result) is kept on the owner’s own server/storage${s.archive.keepDays ? ` for ${s.archive.keepDays} days, then deleted` : ''} for quality and support purposes. Files are never shared with anyone else.`)); });
  main.append(box);
}

function historyView() {
  setMeta(`My Conversions — ${SITE_NAME}`, 'Your recent conversions on this device.');
  const list = historyList();
  const ul = h('ul', { class: 'hist stagger' }, ...list.map(e => h('li', null,
    h('span', { class: 'ext-badge' }, (e.from || 'file').slice(0, 4)),
    h('div', { class: 'qi-main' }, h('div', { class: 'qi-name' }, e.title), h('div', { class: 'qi-meta' }, `${e.files} file${e.files === 1 ? '' : 's'} · ${formatBytes(e.bytes)} · ${e.status === 'success' ? '✅ done' : '❌ ' + (e.error || 'failed')}`), h('div', { class: 'when' }, new Date(e.at).toLocaleString('en-IN'))),
    h('a', { class: 'btn small', href: `/tools/${e.tool}`, 'data-link': '' }, 'Use again'))));
  main.append(h('div', { class: 'container prose', style: 'max-width:860px' },
    h('h1', null, '🕘 My conversions'),
    h('p', null, 'Stored only in this browser. Files themselves are never kept — this is just a list to help you find a tool again.'),
    list.length ? ul : h('p', { class: 'empty' }, 'Nothing yet. Convert something and it will show up here.'),
    list.length ? h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => { historyClear(); render(); } }, 'Clear history')) : null));
}

function notFoundView() {
  setMeta(`Page not found — ${SITE_NAME}`, 'Page not found');
  main.append(h('div', { class: 'container prose', style: 'text-align:center;margin:auto' },
    h('h1', null, '404 — page not found'), h('p', null, 'The page you are looking for does not exist.'),
    h('a', { class: 'btn primary', href: '/', 'data-link': '' }, 'Browse all tools')));
}

// ---------------------------------------------------------------- confetti 🎉
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#ff9933', '#ffffff', '#138808', '#7c6cff', '#38bdf8', '#ff5c8a'];
  const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < 90; i++) {
    const p = h('i');
    p.style.cssText = `left:${Math.random() * 100}vw;background:${colors[i % colors.length]};animation-duration:${1.6 + Math.random() * 1.6}s;animation-delay:${Math.random() * .4}s;transform:rotate(${Math.random() * 360}deg)`;
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3600);
}

// ---------------------------------------------------------------- tool page
function accepts(tool, file) {
  if (!tool.accept || tool.accept === '*') return true;
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return tool.accept.split(',').map(s => s.trim().toLowerCase()).some(tok =>
    tok.startsWith('.') ? name.endsWith(tok) : tok.endsWith('/*') ? type.startsWith(tok.slice(0, -1)) : type === tok);
}
function acceptLabel(tool) {
  if (!tool.accept || tool.accept === '*') return 'Any file type';
  const exts = [...new Set(tool.accept.split(',').filter(s => s.startsWith('.')).map(s => s.slice(1).toUpperCase()))];
  const generic = tool.accept.includes('image/*') ? 'all images' : tool.accept.includes('video/*') ? 'all videos' : tool.accept.includes('audio/*') ? 'all audio' : '';
  return 'Supported: ' + [generic, exts.slice(0, 12).join(', ')].filter(Boolean).join(' · ');
}
const fmtRange = v => Math.round(v * 100) + '%';
const errMsg = e => (e && e.message) || String(e) || 'Unknown error';

function toolView(tool) {
  const cat = CAT.get(tool.cat);
  setMeta(`${tool.title} — Free Online Tool | ${SITE_NAME}`, tool.desc);
  const state = { items: [], outputs: [], values: {}, alive: true, conversionId: null };
  const urls = [];
  const objURL = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const revokeAll = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls.length = 0; };
  for (const o of tool.options) state.values[o.id] = o.default ?? '';
  const allOpts = () => ({ ...tool.params, ...state.values });

  // ----- dropzone
  const fileInput = h('input', { type: 'file', hidden: true, multiple: tool.multiple, accept: tool.accept && tool.accept !== '*' ? tool.accept : null });
  const drop = h('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'Choose files to convert' },
    h('div', { class: 'dz-icon' }, '⬆'),
    h('div', null, h('p', { class: 'dz-title' }, tool.multiple ? 'Drop files here or click to browse' : 'Drop a file here or click to browse'),
      h('p', { class: 'dz-sub' }, acceptLabel(tool), ' · You can also paste (Ctrl+V)'),
      h('div', { class: 'dz-or' }, h('span', { class: 'chip' }, '📁 From computer'), h('span', { class: 'chip' }, '📋 Paste'), h('span', { class: 'chip' }, '📱 Works on phone'))),
    fileInput);
  drop.addEventListener('click', e => { if (e.target !== fileInput) fileInput.click(); });
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  drop.addEventListener('pointermove', e => { const r = drop.getBoundingClientRect(); drop.style.setProperty('--mx', `${e.clientX - r.left}px`); drop.style.setProperty('--my', `${e.clientY - r.top}px`); });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  let dragDepth = 0;
  const onDragEnter = e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; drop.classList.add('over'); } };
  const onDragLeave = () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('over'); } };
  const onDragOver = e => e.preventDefault();
  const onDrop = e => { e.preventDefault(); dragDepth = 0; drop.classList.remove('over'); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); };
  const onPaste = e => { if (e.clipboardData?.files?.length) addFiles(e.clipboardData.files); };
  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  document.addEventListener('paste', onPaste);
  cleanups.push(() => {
    state.alive = false;
    window.removeEventListener('dragenter', onDragEnter); window.removeEventListener('dragleave', onDragLeave);
    window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop);
    document.removeEventListener('paste', onPaste);
    revokeAll();
  });

  function addFiles(list) {
    if (busy) return toast('Please wait until the current conversion finishes.', 'warn');
    const ok = [], bad = [];
    for (const f of list) (accepts(tool, f) ? ok : bad).push(f);
    if (bad.length) toast(`Skipped ${bad.length} unsupported file(s): ${bad.slice(0, 3).map(f => f.name).join(', ')}`, 'warn');
    if (!ok.length) return;
    if (!tool.multiple) { state.items = []; ok.splice(1); }
    for (const f of ok) {
      if (tool.engine === 'media' && f.size > 1.5 * 1024 ** 3) toast(`${f.name} is very large — your browser may run out of memory.`, 'warn');
      state.items.push({ file: f, status: 'ready', progress: 0, error: null, note: '' });
    }
    track.event('files_added', tool.id, { count: ok.length, bytes: ok.reduce((s, f) => s + f.size, 0) });
    drawQueue();
  }

  // ----- options
  const optWraps = [];
  function optField(o) {
    const id = `opt-${o.id}`;
    const set = v => { state.values[o.id] = v; updateVisibility(); };
    let control;
    if (o.type === 'select') {
      control = h('select', { id }, ...o.choices.map(([v, l]) => h('option', { value: v, selected: String(v) === String(o.default) }, l)));
      control.addEventListener('change', () => set(control.value));
    } else if (o.type === 'checkbox') {
      control = h('input', { type: 'checkbox', id, checked: !!o.default });
      control.addEventListener('change', () => set(control.checked));
    } else if (o.type === 'range') {
      const input = h('input', { type: 'range', id, min: o.min, max: o.max, step: o.step, value: o.default });
      const out = h('output', null, fmtRange(o.default));
      input.addEventListener('input', () => { out.textContent = fmtRange(input.value); set(+input.value); });
      control = h('div', { class: 'range' }, input, out);
    } else {
      control = h('input', { type: o.type === 'number' ? 'number' : o.type === 'color' ? 'color' : 'text', id, value: o.default ?? '', placeholder: o.placeholder, min: o.min, max: o.max });
      control.addEventListener('input', () => set(control.value));
    }
    const wrap = o.type === 'checkbox'
      ? h('label', { class: 'opt opt-check' }, control, h('span', null, o.label))
      : h('label', { class: 'opt', for: id }, h('span', { class: 'opt-label' }, o.label, o.required ? ' *' : ''), control, o.help ? h('small', null, o.help) : null);
    optWraps.push([o, wrap]);
    return wrap;
  }
  function visible(o) {
    if (!o.showIf) return true;
    const v = allOpts();
    return Object.entries(o.showIf).every(([k, allowed]) => allowed.includes(String(v[k])));
  }
  function updateVisibility() { for (const [o, w] of optWraps) w.hidden = !visible(o); }
  const optionsPanel = tool.options.length ? h('div', { class: 'panel' }, h('h3', null, '⚙️ Options'), h('div', { class: 'opt-grid' }, ...tool.options.map(optField))) : null;
  updateVisibility();

  // ----- queue, actions, results
  const queueHead = h('div', { class: 'queue-head' });
  const queueEl = h('ul', { class: 'queue' });
  const convertBtn = h('button', { class: 'btn primary big', type: 'button', onclick: run }, 'Convert');
  const clearBtn = h('button', { class: 'btn ghost', type: 'button', onclick: clearAll }, 'Clear all');
  const actions = h('div', { class: 'actions' }, convertBtn, clearBtn);
  const resultsEl = h('div', { class: 'results', hidden: true });
  const notice = h('div', { class: 'notice', hidden: true });
  const feedbackEl = h('div', { class: 'feedback-box', hidden: true });
  if (tool.server || tool.ai) {
    health().then(s => {
      let msg = '';
      if (tool.ai === 'llm' && !s.ai?.llm) msg = '⚠️ The AI model (Ollama) is not running on this server right now, so this tool will not work until it is started. See README → “AI features”.';
      else if (tool.ai === 'whisper' && !s.ai?.whisper) msg = '⚠️ The speech-to-text service (Whisper) is not running on this server right now. See README → “AI features”.';
      else if (tool.server && !tool.ai && !s.office) msg = tool.params.fallback
        ? '⚠️ LibreOffice is not installed on this server, so DOCX files will be converted in basic text-only mode. Install LibreOffice for perfect layout (see README).'
        : '⚠️ This converter needs LibreOffice on the server, which is not installed yet. See README → “Enable Office conversions”.';
      else if (tool.ai) { msg = `✨ Private AI: runs on this server with ${tool.ai === 'whisper' ? 'Whisper' : s.ai?.model || 'a local model'} — your content is never sent to a third party.`; notice.classList.add('info'); }
      if (msg) { notice.hidden = false; notice.textContent = msg; }
    });
  }

  const statusText = it => it.status === 'ready' ? 'Ready'
    : it.status === 'working' ? `${it.note || 'Converting…'} ${it.progress > 0 ? Math.round(it.progress * 100) + '%' : ''}`
      : it.status === 'done' ? 'Done ✓' : `Error: ${it.error}`;
  function updateRow(it) {
    if (it.fill) it.fill.style.width = Math.round(it.progress * 100) + '%';
    if (it.meta) it.meta.textContent = `${formatBytes(it.file.size)} · ${statusText(it)}`;
  }
  function move(i, d) { const [x] = state.items.splice(i, 1); state.items.splice(i + d, 0, x); drawQueue(); }

  function drawQueue() {
    const n = state.items.length;
    const canMove = tool.mode === 'all' && n > 1 && !busy;
    queueEl.replaceChildren(...state.items.map((it, i) => {
      it.fill = h('span'); it.fill.style.width = Math.round(it.progress * 100) + '%';
      it.meta = h('div', { class: 'qi-meta' }, `${formatBytes(it.file.size)} · ${statusText(it)}`);
      return h('li', { class: `qi ${it.status}` },
        h('span', { class: 'ext-badge' }, (extOf(it.file.name) || 'file').slice(0, 4)),
        h('div', { class: 'qi-main' }, h('div', { class: 'qi-name', title: it.file.name }, it.file.name), it.meta,
          h('div', { class: 'bar' + (it.status === 'working' ? '' : ' idle') }, it.fill)),
        h('div', { class: 'qi-actions' },
          canMove ? h('button', { class: 'icon-btn sm', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑') : null,
          canMove ? h('button', { class: 'icon-btn sm', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === n - 1, onclick: () => move(i, 1) }, '↓') : null,
          h('button', { class: 'icon-btn sm', type: 'button', title: 'Remove', 'aria-label': `Remove ${it.file.name}`, disabled: busy, onclick: () => { state.items.splice(i, 1); drawQueue(); } }, '✕')));
    }));
    const total = state.items.reduce((s, it) => s + it.file.size, 0);
    queueHead.replaceChildren(h('span', null, `${n} file${n === 1 ? '' : 's'} · ${formatBytes(total)}`), tool.mode === 'all' && n > 1 ? h('span', null, 'Use ↑ ↓ to set the order') : '');
    queueHead.hidden = !n;
    drop.classList.toggle('compact', n > 0);
    actions.hidden = !n;
    const label = tool.cta || (tool.mode === 'all' ? 'Combine' : 'Convert');
    const allDone = n && state.items.every(it => it.status === 'done');
    convertBtn.disabled = busy || !n;
    clearBtn.disabled = busy;
    convertBtn.replaceChildren(busy ? h('span', { class: 'spinner' }) : '', busy ? ' Working…' : `${allDone ? 'Re-run: ' : ''}${label}${tool.mode === 'each' && n > 1 ? ` ${n} files` : ''} →`);
  }

  function drawResults() {
    resultsEl.hidden = !state.outputs.length;
    if (!state.outputs.length) return;
    const list = h('ul', { class: 'out-list' }, ...state.outputs.map(o => {
      const url = o.url || (o.url = objURL(o.blob));
      const type = o.blob.type || '';
      let thumb;
      if (type.startsWith('image/') && o.blob.size < 40e6) thumb = h('div', { class: 'thumb' }, h('img', { src: url, alt: '', loading: 'lazy' }));
      else if (type.startsWith('audio/')) thumb = h('div', { class: 'thumb media' }, h('audio', { src: url, controls: true, preload: 'none' }));
      else if (type.startsWith('video/')) thumb = h('div', { class: 'thumb media' }, h('video', { src: url, controls: true, preload: 'metadata', muted: true, playsinline: true }));
      else thumb = h('div', { class: 'thumb' }, (extOf(o.name) || 'file').slice(0, 4));
      const dlName = o.name.split('/').pop();
      return h('li', { class: `out${o.text ? ' wide' : ''}` }, thumb,
        h('div', { class: 'out-main' }, h('div', { class: 'qi-name', title: o.name }, o.name), h('div', { class: 'qi-meta' }, formatBytes(o.blob.size), o.info ? ` · ${o.info}` : '')),
        h('div', { class: 'out-actions' },
          o.text ? h('button', { class: 'btn small', type: 'button', onclick: () => navigator.clipboard?.writeText(o.text).then(() => { toast('Copied to clipboard', 'success'); track.download('copy', dlName, o.blob.size, state.conversionId); }, () => toast('Copy failed', 'error')) }, 'Copy') : null,
          navigator.share && o.blob.size < 25e6 ? h('button', { class: 'btn small', type: 'button', onclick: () => shareFile(o) }, 'Share') : null,
          h('a', { class: 'btn small primary', href: url, download: dlName, onclick: () => track.download('single', dlName, o.blob.size, state.conversionId) }, '⬇ Download')),
        o.text ? h('div', { class: 'out-text' }, o.text.slice(0, 20000)) : null);
    }));
    const zipBtn = state.outputs.length > 1 ? h('button', { class: 'btn primary', type: 'button', onclick: downloadAll }, `⬇ Download all (${state.outputs.length}) as ZIP`) : null;
    resultsEl.replaceChildren(h('div', { class: 'results-head' }, h('h3', null, '✅ Your files are ready'), zipBtn), list);
  }
  async function shareFile(o) {
    try {
      const f = new File([o.blob], o.name.split('/').pop(), { type: o.blob.type });
      if (navigator.canShare && !navigator.canShare({ files: [f] })) return toast('Sharing this file type is not supported here.', 'warn');
      await navigator.share({ files: [f], title: o.name });
      track.event('share', tool.id);
    } catch (e) { if (e.name !== 'AbortError') toast('Share failed', 'error'); }
  }

  async function downloadAll(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { zipOutputs } = await import('./engines/files.js');
      const zip = await zipOutputs(state.outputs);
      downloadBlob(zip, `${SITE_NAME.toLowerCase()}-${tool.id}.zip`);
      track.download('zip', `${tool.id}.zip`, zip.size, state.conversionId);
    } catch (err) { toast(errMsg(err), 'error'); } finally { btn.disabled = false; }
  }

  function clearAll() { state.items = []; state.outputs = []; revokeAll(); drawQueue(); drawResults(); feedbackEl.hidden = true; }

  function validate() {
    for (const o of tool.options) {
      if (o.required && visible(o) && String(state.values[o.id] ?? '').trim() === '') return `Please fill in “${o.label}”.`;
    }
    if (tool.minFiles && state.items.length < tool.minFiles) return `Add at least ${tool.minFiles} files.`;
    return null;
  }

  function makeCtx(group) {
    return {
      progress: p => { p = Math.max(0, Math.min(1, Number(p) || 0)); group.forEach(x => { x.progress = p; updateRow(x); }); },
      log: msg => group.forEach(x => { x.note = msg; updateRow(x); }),
      get conversionId() { return state.conversionId; },
    };
  }

  function addOutputs(outs, inSize, ms) {
    for (const o of outs) {
      if (outs.length === 1 && inSize && !o.info) {
        const diff = (o.blob.size - inSize) / inSize;
        o.info = `${Math.abs(Math.round(diff * 100))}% ${diff <= 0 ? 'smaller' : 'larger'} · ${(ms / 1000).toFixed(1)}s`;
      }
      state.outputs.push(o);
    }
    drawResults();
  }

  function showFeedback() {
    let rating = 0;
    const stars = h('div', { class: 'rating' }, ...[1, 2, 3, 4, 5].map(n => h('button', { type: 'button', 'aria-label': `${n} star`, onclick: () => { rating = n; stars.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i < n)); } }, '⭐')));
    const text = h('textarea', { class: 'input', placeholder: 'Anything we can improve? (optional)', rows: '1' });
    const send = h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
      if (!rating && !text.value.trim()) return toast('Pick a star rating first 🙂', 'warn');
      send.disabled = true;
      await track.feedback({ tool_id: tool.id, conversion_id: state.conversionId, rating, comment: text.value.trim(), page: location.pathname });
      feedbackEl.replaceChildren(h('span', null, '🙏 Thank you! Your feedback helps us improve.'));
    } }, 'Send');
    feedbackEl.replaceChildren(h('span', null, h('b', null, 'How was it?')), stars, text, send);
    feedbackEl.hidden = false;
  }

  async function run() {
    if (busy) return;
    if (!state.items.length) return toast('Add a file first.', 'warn');
    const problem = validate();
    if (problem) return toast(problem, 'warn');
    let fn;
    try {
      const mod = await import(`./engines/${tool.engine}.js`);
      fn = mod[tool.fn];
      if (typeof fn !== 'function') throw new Error(`Converter "${tool.fn}" not found`);
    } catch (e) { return toast(`Could not load the converter: ${errMsg(e)}`, 'error'); }

    busy = true;
    const opts = allOpts();
    const pending = state.items.filter(it => it.status !== 'done');
    const items = tool.mode === 'all' ? state.items : (pending.length ? pending : state.items);
    if (tool.mode === 'all' || !pending.length) { state.outputs = []; drawResults(); }
    feedbackEl.hidden = true;

    // --- record the job (metadata only) ---
    const tStart = performance.now();
    const inputs = items.map(it => fileMeta(it.file));
    const safeOpts = Object.fromEntries(Object.entries(opts).filter(([k]) => !/instruction/i.test(k)));
    state.conversionId = null;
    const started = track.startConversion({ tool_id: tool.id, tool_title: tool.title, category: tool.cat, engine: tool.engine, mode: tool.mode,
      location: tool.ai ? 'ai' : tool.server ? 'server' : 'browser', options: safeOpts, inputs, to_ext: opts.to || opts.format || null });
    started.then(r => { if (r?.id) state.conversionId = r.id; });

    if (tool.mode === 'all') {
      items.forEach(it => { it.status = 'working'; it.progress = 0; it.note = ''; it.error = null; });
      drawQueue();
      const t0 = performance.now();
      try {
        await started;
        const outs = await fn(items.map(it => it.file), opts, makeCtx(items));
        items.forEach(it => { it.status = 'done'; it.progress = 1; });
        addOutputs(outs, 0, performance.now() - t0);
      } catch (e) {
        console.error(e);
        items.forEach(it => { it.status = 'error'; it.error = errMsg(e); });
      }
    } else {
      await started;
      for (const it of items) {
        if (!state.alive) break;
        it.status = 'working'; it.progress = 0; it.note = ''; it.error = null;
        drawQueue();
        const t0 = performance.now();
        try {
          const outs = await fn(it.file, opts, makeCtx([it]));
          it.status = 'done'; it.progress = 1;
          addOutputs(outs, it.file.size, performance.now() - t0);
        } catch (e) {
          console.error(e);
          it.status = 'error'; it.error = errMsg(e);
        }
      }
    }
    if (!state.alive) return;
    busy = false;
    drawQueue();
    const failed = items.filter(i => i.status === 'error').length;
    const durationMs = Math.round(performance.now() - tStart);
    const outputs = state.outputs.map(o => ({ name: o.name, ext: extOf(o.name), mime: o.blob.type, size: o.blob.size }));
    const status = failed === items.length ? 'error' : 'success';
    const firstErr = items.find(i => i.status === 'error')?.error;
    track.finishConversion({ id: state.conversionId, status, outputs, duration_ms: durationMs, error: firstErr || null }).then(() => archiveCopies(items));
    historyAdd({ tool: tool.id, title: tool.title, files: items.length, bytes: inputs.reduce((s, f) => s + f.size, 0), from: inputs[0]?.ext, status, error: firstErr });
    if (failed) { toast(`${failed} file(s) failed — see the details in the list.`, 'error'); track.error(firstErr, tool.id); }
    else { toast('Done! Your files are ready to download. 🎉', 'success'); confetti(); resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); showFeedback(); }
  }

  /** ARCHIVE (owner opt-in): send a copy of inputs + outputs to the site's own server. Sequential, background, never blocks the UI. */
  async function archiveCopies(items) {
    const s = await health();
    if (!s.archive?.enabled || !state.conversionId) return;
    const max = (s.archive.maxFileMb || 50) * 1024 * 1024;
    const send = async (blob, name, role) => {
      if (blob.size > max) return;
      const fd = new FormData(); fd.append('conversion_id', String(state.conversionId)); fd.append('role', role); fd.append('file', blob, name);
      await fetch('/api/archive', { method: 'POST', headers: { 'x-ch-session': sid }, body: fd }).catch(() => {});
    };
    for (const it of items) if (it.status === 'done') await send(it.file, it.file.name, 'input');
    for (const o of state.outputs) await send(o.blob, o.name.split('/').pop(), 'output');
  }
  const privacyBadge = h('span', { class: 'badge' }, tool.ai ? '✨ Private AI on our server' : tool.server ? '🖥️ Converted on server · deleted instantly' : '🔒 Runs in your browser · no upload');
  if (tool.ai) privacyBadge.classList.add('ai');
  health().then(s => { if (s.archive?.enabled) privacyBadge.textContent = `${tool.server || tool.ai ? '🖥️ Processed on our server' : '🔒 Converted in your browser'} · a copy is kept by the site owner${s.archive.keepDays ? ` for ${s.archive.keepDays} days` : ''}`; });

  const related = TOOLS.filter(t => t.cat === tool.cat && t.id !== tool.id).sort((a, b) => b.popular - a.popular).slice(0, 8);
  main.append(h('section', { class: 'tool-page' }, h('div', { class: 'container' }, h('div', { class: 'tool-wrap' },
    h('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' }, h('a', { href: '/', 'data-link': '' }, 'Home'), '›', h('a', { href: `/category/${cat.id}`, 'data-link': '' }, cat.name), '›', h('span', null, tool.title)),
    h('div', { class: 'tool-head' }, h('div', { class: 'big-icon', 'data-cat': tool.cat }, cat.icon), h('h1', null, tool.title), h('p', null, tool.desc),
      h('div', { class: 'badges' },
        privacyBadge,
        tool.engine === 'media' ? h('span', { class: 'badge' }, '⚡ FFmpeg WebAssembly') : null,
        tool.multiple ? h('span', { class: 'badge' }, '📦 Batch supported') : null,
        h('span', { class: 'badge' }, '✨ Free · No watermark'))),
    drop, notice, optionsPanel, queueHead, queueEl, actions, resultsEl, feedbackEl),
    section(`How to use ${tool.title}`, null, h('div', { class: 'steps stagger' },
      h('div', null, h('h3', null, 'Add files'), h('p', null, `Drag & drop, click the upload box or paste. ${acceptLabel(tool)}.`)),
      h('div', null, h('h3', null, 'Adjust options'), h('p', null, tool.options.length ? 'Fine-tune quality, size and other settings — or keep the smart defaults.' : 'No setup needed — smart defaults are applied automatically.')),
      h('div', null, h('h3', null, tool.cta || 'Convert'), h('p', null, 'Click the button and download your files individually or all together as a ZIP.')))),
    related.length ? section(`More ${cat.name.toLowerCase()} tools`, null, h('div', { class: 'tool-grid stagger' }, ...related.map(toolCard))) : null,
  )));
  drawQueue();
  drawResults();
  if (pendingFile) { const f = pendingFile; pendingFile = null; addFiles([f]); }
}

// ---------------------------------------------------------------- admin dashboard
function adminView() {
  setMeta(`Admin Dashboard — ${SITE_NAME}`, 'Usage analytics');
  let key = '';
  try { key = sessionStorage.getItem('ch-admin-key') || ''; } catch { /* ignore */ }
  const root = h('div', { class: 'container admin' });
  main.append(root);
  const login = (msg = '') => {
    const input = h('input', { type: 'password', placeholder: 'Admin key (ADMIN_KEY in .env)', autocomplete: 'off' });
    const go = () => { key = input.value.trim(); try { sessionStorage.setItem('ch-admin-key', key); } catch { /* ignore */ } load(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    root.replaceChildren(h('div', { class: 'admin-login' }, h('h1', null, '📊 Admin dashboard'), h('p', { class: 'muted' }, msg || 'Enter the admin key to see usage analytics.'), input, h('button', { class: 'btn primary', type: 'button', onclick: go }, 'Open dashboard')));
    input.focus();
  };
  let days = 14;
  async function load() {
    root.replaceChildren(h('div', { class: 'boot' }, h('div', { class: 'spinner' })));
    const r = await fetch(`/api/admin/summary?days=${days}`, { headers: { 'x-admin-key': key } }).catch(() => null);
    if (!r) return login('Server unreachable.');
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) return login('Wrong key. Try again.');
    if (!r.ok) return login(d.error || 'Error loading dashboard.');
    draw(d);
  }
  const bars = (rows, lbl, val, max) => h('div', { class: 'bars' }, ...rows.map(x => h('div', { class: 'row' }, h('span', { class: 'lbl', title: lbl(x) }, lbl(x)), h('span', { class: 'trk' }, h('i', { style: `width:${max ? Math.max(2, 100 * val(x) / max) : 0}%` })), h('span', { class: 'val' }, fmtNum(val(x))))));
  const table = (cols, rows) => h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ...cols.map(c => h('th', null, c[0])))),
    h('tbody', null, ...(rows.length ? rows.map(rw => h('tr', null, ...cols.map(c => h('td', { class: c[2] || '' }, c[1](rw))))) : [h('tr', null, h('td', { colspan: cols.length, class: 'muted' }, 'No data yet'))]))));
  function draw(d) {
    const t = d.totals || {};
    const kpi = (v, l, accent) => h('div', { class: `kpi${accent ? ' accent' : ''}` }, h('b', null, v), h('span', null, l));
    const mb = b => (Number(b) > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(Number(b) / 1e6).toFixed(1)} MB`);
    const maxDay = Math.max(1, ...d.daily.map(x => Number(x.conversions)));
    const chart = h('div', { class: 'chart' }, ...d.daily.map(x => h('div', { class: 'col', title: `${x.day}: ${x.conversions} conversions (${x.failed} failed), ${x.unique_users} users` },
      h('i', { style: `height:${Math.max(2, 140 * Number(x.conversions) / maxDay)}px`, class: Number(x.failed) > Number(x.successful) ? 'err' : '' }), h('small', null, x.day.slice(5)))));
    const hourMax = Math.max(1, ...d.hourly.map(x => Number(x.conversions)));
    const hours = h('div', { class: 'chart', style: 'height:90px' }, ...Array.from({ length: 24 }, (_, hr) => { const row = d.hourly.find(x => Number(x.hour_of_day) === hr); const n = Number(row?.conversions || 0); return h('div', { class: 'col', title: `${hr}:00 — ${n}` }, h('i', { style: `height:${Math.max(2, 70 * n / hourMax)}px` }), hr % 3 === 0 ? h('small', null, hr) : null); }));
    const sel = h('select', { class: 'input', style: 'padding:6px 10px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border)' }, ...[7, 14, 30, 90].map(n => h('option', { value: n, selected: n === days }, `Last ${n} days`)));
    sel.addEventListener('change', () => { days = Number(sel.value); load(); });
    root.replaceChildren(
      h('div', { class: 'section-head' }, h('div', null, h('span', { class: 'eyebrow' }, 'ConvertHub'), h('h1', null, '📊 Admin dashboard')),
        h('div', { style: 'display:flex;gap:8px;align-items:center' }, sel, h('button', { class: 'btn small', type: 'button', onclick: load }, '↻ Refresh'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => { key = ''; try { sessionStorage.removeItem('ch-admin-key'); } catch { /* ignore */ } login(); } }, 'Lock'))),
      h('div', { class: 'kpis stagger' },
        kpi(fmtNum(t.conversions), 'total conversions', true), kpi(fmtNum(t.today), 'today'), kpi(fmtNum(t.online_now), 'online now (5 min)'), kpi(fmtNum(t.sessions), 'unique visitors'),
        kpi(fmtNum(t.page_views), 'page views'), kpi(fmtNum(t.files_uploaded), 'files processed'), kpi(mb(t.input_bytes), 'data in'), kpi(mb(t.output_bytes), 'data out'),
        kpi(`${t.conversions ? Math.round(100 * t.successful / t.conversions) : 0}%`, 'success rate'), kpi(fmtNum(t.downloads), 'downloads'), kpi(fmtNum(t.ai_requests), 'AI requests'), kpi(t.avg_rating ? `${t.avg_rating} ★` : '—', `rating (${fmtNum(t.feedback)} reviews)`), kpi(fmtNum(t.errors), 'errors logged')),
      h('div', { class: 'admin-grid' },
        h('div', { class: 'card wide' }, h('h3', null, `Conversions per day (last ${d.days} days)`), chart),
        h('div', { class: 'card' }, h('h3', null, 'Most used tools'), bars(d.tools, x => x.tool_title || x.tool_id, x => Number(x.runs), Number(d.tools[0]?.runs))),
        h('div', { class: 'card' }, h('h3', null, 'Format pairs'), bars(d.pairs, x => `${x.from_ext || '?'} → ${x.to_ext || '?'}`, x => Number(x.runs), Number(d.pairs[0]?.runs))),
        h('div', { class: 'card' }, h('h3', null, 'Busiest hours'), hours),
        h('div', { class: 'card' }, h('h3', null, 'Where work happens'), bars(d.locations, x => x.location, x => Number(x.n), Math.max(...d.locations.map(x => Number(x.n)), 1)),
          h('h3', { style: 'margin-top:16px' }, 'Devices'), bars(d.devices, x => x.device, x => Number(x.n), Number(d.devices[0]?.n)),
          h('h3', { style: 'margin-top:16px' }, 'Browsers'), bars(d.browsers, x => x.browser, x => Number(x.n), Number(d.browsers[0]?.n))),
        h('div', { class: 'card' }, h('h3', null, 'Top searches'), bars(d.searches, x => x.query, x => Number(x.n), Number(d.searches[0]?.n)),
          h('h3', { style: 'margin-top:16px' }, '💡 Searched but not found (tools to build next)'), d.missing.length ? bars(d.missing, x => x.query, x => Number(x.times_searched), Number(d.missing[0]?.times_searched)) : h('p', { class: 'muted' }, 'None — every search found a tool 🎉')),
        h('div', { class: 'card' }, h('h3', null, '✨ AI usage'), table([['Feature', x => x.feature], ['Calls', x => fmtNum(x.n)], ['OK', x => fmtNum(x.ok)], ['Avg s', x => x.avg_s ?? '—']], d.ai),
          h('h3', { style: 'margin-top:16px' }, 'Latest feedback'), table([['When', x => new Date(x.created_at).toLocaleString('en-IN')], ['Tool', x => x.tool_id || '—'], ['★', x => x.rating ?? '—'], ['Comment', x => x.comment || '—', 'trunc']], d.feedback)),
        d.archive?.enabled ? h('div', { class: 'card wide' }, h('h3', null, '📁 File archive', h('span', { class: `pill ${d.archive.drive.enabled ? (d.archive.drive.ok ? 'success' : 'error') : 'started'}` }, d.archive.drive.enabled ? (d.archive.drive.ok ? 'Google Drive connected' : 'Google Drive: not connected') : 'local disk only')),
          h('div', { class: 'kpis', style: 'margin:0 0 10px' }, kpi(fmtNum(d.archive.totals.archived), 'files archived'), kpi(fmtNum(d.archive.totals.on_drive), 'uploaded to Drive'), kpi(mb(d.archive.disk.bytes), `on local disk (${fmtNum(d.archive.disk.files)} files)`), kpi(d.archive.keepDays ? `${d.archive.keepDays} days` : '∞', 'kept for'), kpi(fmtNum(d.archive.drive.queue || 0), 'waiting to upload')),
          h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, `Local folder: ${d.archive.dir}`, d.archive.drive.enabled ? h('span', null, ' · Drive: ', d.archive.drive.folderUrl ? h('a', { href: d.archive.drive.folderUrl, target: '_blank', rel: 'noopener' }, `${d.archive.drive.remote}:${d.archive.drive.folder} ↗`) : `${d.archive.drive.remote}:${d.archive.drive.folder}`, d.archive.drive.error ? h('span', { style: 'color:var(--err)' }, ` — ${d.archive.drive.error}`) : null) : null)) : null,
        h('div', { class: 'card wide' }, h('h3', null, 'Recent conversions'), table([
          ['When', x => new Date(x.started_at).toLocaleString('en-IN')], ['Tool', x => x.tool_title], ['Status', x => h('span', { class: `pill ${x.status}` }, x.status)], ['Where', x => x.location],
          ['Files', x => x.files?.length ? h('span', { style: 'display:flex;gap:4px;flex-wrap:wrap' }, ...x.files.filter(f => f.local || f.drive_url).map(f => h('a', { class: 'pill success', href: `/api/admin/file/${f.id}?key=${encodeURIComponent(key)}`, title: `${f.name} · ${Math.round(f.size_bytes / 1024)} KB${f.drive_url ? ' · on Drive' : ''}` }, `⬇ ${f.role === 'input' ? 'in' : 'out'}`))) : x.input_count], ['Size', x => `${x.input_kb} KB`], ['From → To', x => `${x.from_ext || '?'} → ${x.to_ext || '?'}`], ['Secs', x => x.seconds ?? '—'], ['Device', x => `${x.device} · ${x.browser}`], ['Error', x => x.error_message || '', 'trunc']], d.recent)),
        h('div', { class: 'card wide' }, h('h3', null, 'Recent errors'), table([['When', x => new Date(x.created_at).toLocaleString('en-IN')], ['Source', x => x.source], ['Tool', x => x.tool_id || '—'], ['Message', x => x.message, 'trunc']], d.errors)),
      ),
      h('p', { class: 'muted', style: 'margin-top:16px;font-size:12.5px' }, `Generated ${new Date(d.generated_at).toLocaleString('en-IN')} · Data lives in MySQL database "converthub" — open it in Navicat for the full tables and views.`));
  }
  key ? load() : login();
}

initHeader();
track.session();
render();
