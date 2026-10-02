// Spreadsheet engine — SheetJS (XLSX, XLS, ODS, CSV, TSV, JSON, HTML)
import { loadScript, extOf, baseName } from '../utils.js';

async function XLSXLib() { await loadScript('/vendor/xlsx/xlsx.full.min.js'); return window.XLSX; }
const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet', csv: 'text/csv;charset=utf-8', tsv: 'text/tab-separated-values;charset=utf-8',
  json: 'application/json', html: 'text/html;charset=utf-8',
};
const safeSheet = s => String(s).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
const safeFile = s => String(s).replace(/[\\/:*?"<>|]/g, '_');

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

async function readWorkbook(file) {
  const XLSX = await XLSXLib();
  const ext = extOf(file.name);
  if (ext === 'json') {
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new Error('Invalid JSON file.'); }
    const wb = XLSX.utils.book_new();
    const addSheet = (name, rows) => XLSX.utils.book_append_sheet(wb,
      XLSX.utils.json_to_sheet(rows.map(r => (r && typeof r === 'object' ? flatten(r) : { value: r }))), safeSheet(name));
    if (Array.isArray(data)) addSheet('Sheet1', data);
    else if (data && typeof data === 'object' && Object.values(data).length && Object.values(data).every(Array.isArray)) {
      Object.entries(data).forEach(([k, v]) => addSheet(k, v)); // { "Sheet A": [...], "Sheet B": [...] }
    } else addSheet('Sheet1', [data]);
    return wb;
  }
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const text = await file.text();
    return XLSX.read(text, { type: 'string', ...(ext === 'tsv' ? { FS: '\t' } : {}) });
  }
  try { return XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); }
  catch { throw new Error('Could not read this spreadsheet (it may be damaged or password-protected).'); }
}

export async function convert(file, o, ctx) {
  const XLSX = await XLSXLib();
  ctx.log('Reading…');
  const wb = await readWorkbook(file);
  ctx.progress(0.5);
  const to = o.to || 'xlsx';
  const base = baseName(file.name);
  if (['xlsx', 'xls', 'ods'].includes(to)) {
    const data = XLSX.write(wb, { bookType: to === 'xls' ? 'biff8' : to, type: 'array', compression: true });
    return [{ name: `${base}.${to}`, blob: new Blob([data], { type: MIME[to] }) }];
  }
  const names = o.sheets === 'first' ? wb.SheetNames.slice(0, 1) : wb.SheetNames;
  if (to === 'json') {
    const rows = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });
    const out = names.length === 1 ? rows(names[0]) : Object.fromEntries(names.map(n => [n, rows(n)]));
    return [{ name: `${base}.json`, blob: new Blob([JSON.stringify(out, null, 2)], { type: MIME.json }) }];
  }
  if (to === 'html') {
    const body = names.map(n => `<h2>${n.replace(/</g, '&lt;')}</h2>` + XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })).join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${base}</title><style>body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse;margin-bottom:28px}td,th{border:1px solid #ccc;padding:6px 10px}tr:nth-child(even){background:#f6f6fb}</style></head><body>${body}</body></html>`;
    return [{ name: `${base}.html`, blob: new Blob([html], { type: MIME.html }) }];
  }
  // csv / tsv: one file per sheet
  return names.map(n => {
    const text = XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: to === 'tsv' ? '\t' : (o.delimiter || ','), blankrows: false });
    const name = names.length === 1 ? `${base}.${to}` : `${base}-${safeFile(n)}.${to}`;
    return { name, blob: new Blob([(o.bom !== false ? '\uFEFF' : '') + text], { type: MIME[to] }) };
  });
}
