// Anonymous usage tracking → /api/track/* → MySQL.
// - One random UUID per browser (localStorage). No cookies, no personal data, no file contents.
// - Everything is fire-and-forget: a failed request never affects the UI.
// - Also keeps a local "My conversions" history (localStorage) for the /history page.
const KEY = 'ch-sid';
const HIST = 'ch-history';

export const sid = (() => {
  try {
    let v = localStorage.getItem(KEY);
    if (!v) { v = crypto.randomUUID(); localStorage.setItem(KEY, v); }
    return v;
  } catch { return crypto.randomUUID(); }
})();

function post(path, body) {
  try {
    const json = JSON.stringify(body || {});
    // keepalive lets the request finish even if the page is unloading (e.g. download click → navigate)
    return fetch(path, { method: 'POST', keepalive: json.length < 60000, headers: { 'content-type': 'application/json', 'x-ch-session': sid }, body: json })
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
  } catch { return Promise.resolve(null); }
}

const utm = (() => { const p = new URLSearchParams(location.search); return { utm_source: p.get('utm_source'), utm_medium: p.get('utm_medium'), utm_campaign: p.get('utm_campaign') }; })();

export const track = {
  session() {
    let newVisit = false;
    try { if (!sessionStorage.getItem('ch-visit')) { sessionStorage.setItem('ch-visit', '1'); newVisit = true; } } catch { /* ignore */ }
    return post('/api/track/session', {
      newVisit, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen: `${screen.width}x${screen.height}`, theme: document.documentElement.dataset.theme, referrer: document.referrer || null, ...utm,
    });
  },
  view(path, toolId, category) { return post('/api/track/view', { path, tool_id: toolId || null, category: category || null, referrer: document.referrer || null }); },
  search(query, source, results, picked) { return post('/api/track/search', { query, source, results, picked_tool: picked || null }); },
  event(name, toolId, props) { return post('/api/track/event', { name, tool_id: toolId || null, props: props || null }); },
  download(kind, fileName, size, conversionId) { return post('/api/track/download', { kind, file_name: fileName, size_bytes: size, conversion_id: conversionId || null }); },
  error(message, toolId, stack) { return post('/api/track/error', { message, tool_id: toolId || null, stack, url: location.href }); },
  startConversion(p) { return post('/api/track/conversion/start', p); },
  finishConversion(p) { return post('/api/track/conversion/finish', p); },
  feedback(p) { return post('/api/feedback', p); },
};

export const fileMeta = f => ({ name: f.name, ext: (f.name.split('.').pop() || '').toLowerCase(), mime: f.type || null, size: f.size });

// ---------- local history (device only) ----------
export function historyAdd(entry) {
  try {
    const list = historyList();
    list.unshift({ ...entry, at: Date.now() });
    localStorage.setItem(HIST, JSON.stringify(list.slice(0, 100)));
  } catch { /* storage full / private mode */ }
}
export function historyList() { try { return JSON.parse(localStorage.getItem(HIST) || '[]'); } catch { return []; } }
export function historyClear() { try { localStorage.removeItem(HIST); } catch { /* ignore */ } }

// Browser errors → DB (helps you see what breaks for real users)
window.addEventListener('error', e => track.error(e.message, null, e.error?.stack));
window.addEventListener('unhandledrejection', e => track.error(String(e.reason?.message || e.reason), null, e.reason?.stack));
