// ConvertHub database layer (MySQL 8 via mysql2)
// - Creates the "converthub" database + every table/view on first start (idempotent)
// - Records: visitor sessions, page views, uploaded/converted file metadata, conversions,
//   downloads, searches, AI requests, feedback and errors
// - NEVER stores file CONTENTS — only metadata (name, size, type, hash, dimensions)
// - Fully optional: if MySQL is unreachable the website keeps working, we just log a warning
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

const cfg = {
  enabled: process.env.DB_ENABLED !== 'false',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME || 'converthub',
  ipSalt: process.env.IP_HASH_SALT || 'converthub-salt',
};

let pool = null;
let ready = false;
let lastError = null;

// Table definitions — order matters (foreign keys)
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    visits INT UNSIGNED NOT NULL DEFAULT 1,
    user_agent VARCHAR(512) NULL,
    device ENUM('desktop','mobile','tablet','bot','unknown') NOT NULL DEFAULT 'unknown',
    browser VARCHAR(64) NULL,
    os VARCHAR(64) NULL,
    ip_hash CHAR(64) NULL COMMENT 'SHA-256 of IP + salt (never the raw IP)',
    language VARCHAR(16) NULL,
    timezone VARCHAR(64) NULL,
    screen VARCHAR(16) NULL,
    theme VARCHAR(8) NULL,
    referrer VARCHAR(512) NULL,
    utm_source VARCHAR(128) NULL,
    utm_medium VARCHAR(128) NULL,
    utm_campaign VARCHAR(128) NULL,
    KEY idx_sessions_last_seen (last_seen),
    KEY idx_sessions_device (device)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Anonymous visitors (one row per browser)'`,

  `CREATE TABLE IF NOT EXISTS page_views (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    path VARCHAR(255) NOT NULL,
    tool_id VARCHAR(64) NULL,
    category VARCHAR(32) NULL,
    referrer VARCHAR(512) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_pv_session (session_id),
    KEY idx_pv_tool (tool_id),
    KEY idx_pv_created (created_at),
    CONSTRAINT fk_pv_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Every page opened'`,

  `CREATE TABLE IF NOT EXISTS conversions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL UNIQUE,
    session_id CHAR(36) NOT NULL,
    tool_id VARCHAR(64) NOT NULL,
    tool_title VARCHAR(128) NULL,
    category VARCHAR(32) NULL,
    engine VARCHAR(32) NULL,
    mode ENUM('each','all') NOT NULL DEFAULT 'each',
    location ENUM('browser','server','ai') NOT NULL DEFAULT 'browser' COMMENT 'where the work happened',
    status ENUM('started','success','error','cancelled') NOT NULL DEFAULT 'started',
    options_json JSON NULL,
    input_count INT UNSIGNED NOT NULL DEFAULT 0,
    input_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    output_count INT UNSIGNED NOT NULL DEFAULT 0,
    output_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    from_ext VARCHAR(16) NULL,
    to_ext VARCHAR(16) NULL,
    duration_ms INT UNSIGNED NULL,
    error_message VARCHAR(1000) NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME NULL,
    KEY idx_conv_session (session_id),
    KEY idx_conv_tool (tool_id),
    KEY idx_conv_status (status),
    KEY idx_conv_started (started_at),
    KEY idx_conv_pair (from_ext, to_ext),
    CONSTRAINT fk_conv_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='One row per conversion job (browser, server or AI)'`,

  `CREATE TABLE IF NOT EXISTS files (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    conversion_id BIGINT UNSIGNED NULL,
    role ENUM('input','output') NOT NULL,
    name VARCHAR(512) NOT NULL,
    ext VARCHAR(16) NULL,
    mime VARCHAR(128) NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    sha256 CHAR(64) NULL,
    width INT UNSIGNED NULL,
    height INT UNSIGNED NULL,
    pages INT UNSIGNED NULL,
    duration_sec DECIMAL(10,2) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_files_session (session_id),
    KEY idx_files_conv (conversion_id),
    KEY idx_files_ext (ext),
    KEY idx_files_created (created_at),
    CONSTRAINT fk_files_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_files_conv FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Metadata of every uploaded (input) and produced (output) file. Contents are never stored.'`,

  `CREATE TABLE IF NOT EXISTS downloads (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    conversion_id BIGINT UNSIGNED NULL,
    kind ENUM('single','zip','copy') NOT NULL DEFAULT 'single',
    file_name VARCHAR(512) NULL,
    size_bytes BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_dl_session (session_id),
    KEY idx_dl_conv (conversion_id),
    CONSTRAINT fk_dl_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_dl_conv FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Download / copy-to-clipboard actions'`,

  `CREATE TABLE IF NOT EXISTS searches (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    query VARCHAR(255) NOT NULL,
    source ENUM('header','hero','palette','ai','smartdrop') NOT NULL DEFAULT 'header',
    results INT UNSIGNED NOT NULL DEFAULT 0,
    picked_tool VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_search_session (session_id),
    KEY idx_search_created (created_at),
    CONSTRAINT fk_search_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='What people search for (tells you which tools to build next)'`,

  `CREATE TABLE IF NOT EXISTS events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    name VARCHAR(64) NOT NULL,
    tool_id VARCHAR(64) NULL,
    props JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ev_session (session_id),
    KEY idx_ev_name (name),
    KEY idx_ev_created (created_at),
    CONSTRAINT fk_ev_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Generic UI events (theme change, option change, share, palette open...)'`,

  `CREATE TABLE IF NOT EXISTS ai_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NULL,
    conversion_id BIGINT UNSIGNED NULL,
    feature VARCHAR(32) NOT NULL COMMENT 'find-tool | summarize | translate | keypoints | simplify | transcribe | custom',
    provider VARCHAR(32) NOT NULL DEFAULT 'ollama',
    model VARCHAR(64) NULL,
    input_chars INT UNSIGNED NULL,
    output_chars INT UNSIGNED NULL,
    input_bytes BIGINT UNSIGNED NULL,
    target_lang VARCHAR(32) NULL,
    duration_ms INT UNSIGNED NULL,
    status ENUM('success','error') NOT NULL DEFAULT 'success',
    error_message VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ai_session (session_id),
    KEY idx_ai_feature (feature),
    KEY idx_ai_created (created_at),
    CONSTRAINT fk_ai_conv FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Every call to the local AI (Ollama / Whisper)'`,

  `CREATE TABLE IF NOT EXISTS feedback (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NULL,
    tool_id VARCHAR(64) NULL,
    conversion_id BIGINT UNSIGNED NULL,
    rating TINYINT UNSIGNED NULL COMMENT '1-5 stars',
    comment TEXT NULL,
    page VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_fb_tool (tool_id),
    KEY idx_fb_created (created_at),
    CONSTRAINT fk_fb_conv FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Star ratings and comments from users'`,

  `CREATE TABLE IF NOT EXISTS error_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NULL,
    source ENUM('browser','server') NOT NULL,
    tool_id VARCHAR(64) NULL,
    message VARCHAR(2000) NOT NULL,
    stack TEXT NULL,
    url VARCHAR(512) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_err_created (created_at),
    KEY idx_err_tool (tool_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Errors from the browser and the server'`,

  // ---------- Reporting views (open these in Navicat for instant answers) ----------
  `CREATE OR REPLACE VIEW v_daily_summary AS
    SELECT DATE(started_at) AS day,
           COUNT(*) AS conversions,
           SUM(status = 'success') AS successful,
           SUM(status = 'error') AS failed,
           COUNT(DISTINCT session_id) AS unique_users,
           SUM(input_count) AS files_in,
           ROUND(SUM(input_bytes) / 1048576, 2) AS input_mb,
           ROUND(SUM(output_bytes) / 1048576, 2) AS output_mb,
           ROUND(AVG(duration_ms) / 1000, 2) AS avg_seconds
    FROM conversions GROUP BY DATE(started_at) ORDER BY day DESC`,

  `CREATE OR REPLACE VIEW v_tool_popularity AS
    SELECT tool_id, MAX(tool_title) AS tool_title, MAX(category) AS category,
           COUNT(*) AS runs, SUM(status = 'success') AS successful, SUM(status = 'error') AS failed,
           ROUND(100 * SUM(status = 'success') / COUNT(*), 1) AS success_rate_pct,
           COUNT(DISTINCT session_id) AS unique_users,
           ROUND(SUM(input_bytes) / 1048576, 2) AS input_mb,
           ROUND(AVG(duration_ms) / 1000, 2) AS avg_seconds,
           MAX(started_at) AS last_used
    FROM conversions GROUP BY tool_id ORDER BY runs DESC`,

  `CREATE OR REPLACE VIEW v_format_pairs AS
    SELECT from_ext, to_ext, COUNT(*) AS runs, SUM(status = 'success') AS successful,
           ROUND(SUM(input_bytes) / 1048576, 2) AS input_mb
    FROM conversions WHERE from_ext IS NOT NULL GROUP BY from_ext, to_ext ORDER BY runs DESC`,

  `CREATE OR REPLACE VIEW v_hourly_activity AS
    SELECT HOUR(started_at) AS hour_of_day, COUNT(*) AS conversions
    FROM conversions GROUP BY HOUR(started_at) ORDER BY hour_of_day`,

  `CREATE OR REPLACE VIEW v_recent_activity AS
    SELECT c.id, c.public_id, c.started_at, c.tool_title, c.status, c.location,
           c.input_count, ROUND(c.input_bytes / 1024, 1) AS input_kb, c.from_ext, c.to_ext,
           ROUND(c.duration_ms / 1000, 2) AS seconds, c.error_message, s.device, s.browser, s.os
    FROM conversions c JOIN sessions s ON s.id = c.session_id
    ORDER BY c.started_at DESC`,

  `CREATE OR REPLACE VIEW v_missing_tools AS
    SELECT query, COUNT(*) AS times_searched, MAX(created_at) AS last_searched
    FROM searches WHERE results = 0 GROUP BY query ORDER BY times_searched DESC`,
];

export async function initDb() {
  if (!cfg.enabled) { console.log('  ➜ Database: disabled (DB_ENABLED=false)'); return false; }
  try {
    // Step 1: connect without a database and create ours (only touches "converthub")
    const admin = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, connectTimeout: 5000 });
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await admin.end();
    // Step 2: pool against the database + create tables/views
    pool = mysql.createPool({
      host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
      waitForConnections: true, connectionLimit: 10, queueLimit: 0, charset: 'utf8mb4', timezone: 'local',
      enableKeepAlive: true, keepAliveInitialDelay: 10000, namedPlaceholders: true,
    });
    for (const sql of SCHEMA) await pool.query(sql);
    await migrate();
    ready = true;
    lastError = null;
    console.log(`  ➜ Database: ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database} ✓ (${SCHEMA.length} objects ready)`);
    return true;
  } catch (e) {
    ready = false;
    lastError = e.message;
    console.warn(`  ➜ Database: NOT connected (${e.code || e.message}). Site still works; nothing will be recorded.`);
    return false;
  }
}

// Columns added after v2.0 — MySQL has no "ADD COLUMN IF NOT EXISTS", so check information_schema first
const MIGRATIONS = [
  ['files', 'storage_path', 'VARCHAR(512) NULL COMMENT "relative path in the local archive folder (ARCHIVE_FILES=true)"'],
  ['files', 'drive_file_id', 'VARCHAR(128) NULL COMMENT "Google Drive file id once uploaded"'],
  ['files', 'drive_url', 'VARCHAR(255) NULL'],
  ['files', 'archived_at', 'DATETIME NULL'],
];
async function migrate() {
  const [cols] = await pool.query('SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?', [cfg.database]);
  const have = new Set(cols.map(r => `${r.t}.${r.c}`));
  for (const [table, col, def] of MIGRATIONS) if (!have.has(`${table}.${col}`)) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
}

export const dbStatus = () => ({ enabled: cfg.enabled, ready, database: cfg.database, host: `${cfg.host}:${cfg.port}`, error: lastError });

/** Run a query but never crash the request if the DB is down. */
async function safe(sql, params) {
  if (!ready) return null;
  try { const [rows] = await pool.query(sql, params); return rows; }
  catch (e) {
    lastError = e.message;
    console.warn('[db]', e.code || '', e.message.slice(0, 200));
    return null;
  }
}

export const hashIp = ip => (ip ? crypto.createHash('sha256').update(cfg.ipSalt + String(ip)).digest('hex') : null);
const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const str = (v, n) => (v == null ? null : String(v).slice(0, n));
const num = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
const json = v => (v && typeof v === 'object' ? JSON.stringify(v).slice(0, 8000) : null);

/** Very small UA parser — enough for dashboards, no dependency. */
export function parseUa(ua = '') {
  const s = String(ua);
  const device = /bot|crawl|spider|slurp|curl|wget/i.test(s) ? 'bot' : /iPad|Tablet/i.test(s) ? 'tablet' : /Mobi|Android|iPhone/i.test(s) ? 'mobile' : s ? 'desktop' : 'unknown';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Brave/.test(s) ? 'Brave' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Other';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : 'Other';
  return { device, browser, os };
}

// ---------- write helpers (all fire-and-forget safe) ----------
export async function upsertSession(id, meta = {}, ip, ua) {
  if (!isUuid(id)) return null;
  const { device, browser, os } = parseUa(ua);
  return safe(`INSERT INTO sessions (id, user_agent, device, browser, os, ip_hash, language, timezone, screen, theme, referrer, utm_source, utm_medium, utm_campaign)
    VALUES (:id, :ua, :device, :browser, :os, :ip, :language, :timezone, :screen, :theme, :referrer, :utm_source, :utm_medium, :utm_campaign)
    ON DUPLICATE KEY UPDATE last_seen = CURRENT_TIMESTAMP, visits = visits + :bump, theme = COALESCE(:theme, theme), language = COALESCE(:language, language),
      user_agent = COALESCE(:ua, user_agent), device = :device, browser = :browser, os = :os, ip_hash = COALESCE(:ip, ip_hash)`,
  { id, ua: str(ua, 512), device, browser, os, ip: hashIp(ip), language: str(meta.language, 16), timezone: str(meta.timezone, 64), screen: str(meta.screen, 16),
    theme: str(meta.theme, 8), referrer: str(meta.referrer, 512), utm_source: str(meta.utm_source, 128), utm_medium: str(meta.utm_medium, 128), utm_campaign: str(meta.utm_campaign, 128),
    bump: meta.newVisit ? 1 : 0 });
}

export const insertPageView = (sid, p) => isUuid(sid) && safe(
  'INSERT INTO page_views (session_id, path, tool_id, category, referrer) VALUES (?, ?, ?, ?, ?)',
  [sid, str(p.path, 255) || '/', str(p.tool_id, 64), str(p.category, 32), str(p.referrer, 512)]);

export const insertSearch = (sid, p) => isUuid(sid) && p.query && safe(
  'INSERT INTO searches (session_id, query, source, results, picked_tool) VALUES (?, ?, ?, ?, ?)',
  [sid, str(p.query, 255), ['header', 'hero', 'palette', 'ai', 'smartdrop'].includes(p.source) ? p.source : 'header', num(p.results), str(p.picked_tool, 64)]);

export const insertEvent = (sid, p) => isUuid(sid) && p.name && safe(
  'INSERT INTO events (session_id, name, tool_id, props) VALUES (?, ?, ?, ?)',
  [sid, str(p.name, 64), str(p.tool_id, 64), json(p.props)]);

export const insertDownload = (sid, p) => isUuid(sid) && safe(
  'INSERT INTO downloads (session_id, conversion_id, kind, file_name, size_bytes) VALUES (?, ?, ?, ?, ?)',
  [sid, p.conversion_id ? num(p.conversion_id) : null, ['single', 'zip', 'copy'].includes(p.kind) ? p.kind : 'single', str(p.file_name, 512), num(p.size_bytes)]);

export const insertFeedback = (sid, p) => safe(
  'INSERT INTO feedback (session_id, tool_id, conversion_id, rating, comment, page) VALUES (?, ?, ?, ?, ?, ?)',
  [isUuid(sid) ? sid : null, str(p.tool_id, 64), p.conversion_id ? num(p.conversion_id) : null, p.rating ? Math.min(5, Math.max(1, num(p.rating))) : null, str(p.comment, 4000), str(p.page, 255)]);

export const insertError = (sid, p) => safe(
  'INSERT INTO error_logs (session_id, source, tool_id, message, stack, url) VALUES (?, ?, ?, ?, ?, ?)',
  [isUuid(sid) ? sid : null, p.source === 'server' ? 'server' : 'browser', str(p.tool_id, 64), str(p.message, 2000) || 'Unknown error', str(p.stack, 20000), str(p.url, 512)]);

export const insertAiRequest = (sid, p) => safe(
  `INSERT INTO ai_requests (session_id, conversion_id, feature, provider, model, input_chars, output_chars, input_bytes, target_lang, duration_ms, status, error_message)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [isUuid(sid) ? sid : null, p.conversion_id ? num(p.conversion_id) : null, str(p.feature, 32), str(p.provider, 32) || 'ollama', str(p.model, 64),
    p.input_chars == null ? null : num(p.input_chars), p.output_chars == null ? null : num(p.output_chars), p.input_bytes == null ? null : num(p.input_bytes),
    str(p.target_lang, 32), num(p.duration_ms), p.status === 'error' ? 'error' : 'success', str(p.error_message, 1000)]);

/** Insert a conversion + its input files. Returns the numeric id (or null if DB is off). */
export async function startConversion(sid, p) {
  if (!isUuid(sid)) return null;
  const inputs = Array.isArray(p.inputs) ? p.inputs.slice(0, 500) : [];
  const inputBytes = inputs.reduce((s, f) => s + num(f.size), 0);
  const fromExt = inputs.length ? str((inputs[0].ext || '').toLowerCase(), 16) : null;
  const publicId = crypto.randomUUID();
  const r = await safe(
    `INSERT INTO conversions (public_id, session_id, tool_id, tool_title, category, engine, mode, location, options_json, input_count, input_bytes, from_ext, to_ext)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [publicId, sid, str(p.tool_id, 64) || 'unknown', str(p.tool_title, 128), str(p.category, 32), str(p.engine, 32), p.mode === 'all' ? 'all' : 'each',
      ['browser', 'server', 'ai'].includes(p.location) ? p.location : 'browser', json(p.options), inputs.length, inputBytes, fromExt, str(p.to_ext, 16)]);
  if (!r?.insertId) return null;
  if (inputs.length) {
    await safe('INSERT INTO files (session_id, conversion_id, role, name, ext, mime, size_bytes, sha256, width, height, pages, duration_sec) VALUES ?',
      [inputs.map(f => [sid, r.insertId, 'input', str(f.name, 512) || 'file', str((f.ext || '').toLowerCase(), 16), str(f.mime, 128), num(f.size),
        /^[0-9a-f]{64}$/i.test(f.sha256 || '') ? f.sha256.toLowerCase() : null, f.width ? num(f.width) : null, f.height ? num(f.height) : null, f.pages ? num(f.pages) : null,
        f.duration ? Number(f.duration).toFixed(2) : null])]);
  }
  return { id: r.insertId, public_id: publicId };
}

export async function finishConversion(sid, id, p) {
  if (!isUuid(sid) || !id) return null;
  const outputs = Array.isArray(p.outputs) ? p.outputs.slice(0, 500) : [];
  const outputBytes = outputs.reduce((s, f) => s + num(f.size), 0);
  const status = ['success', 'error', 'cancelled'].includes(p.status) ? p.status : 'success';
  const r = await safe(
    `UPDATE conversions SET status = ?, output_count = ?, output_bytes = ?, duration_ms = ?, error_message = ?, finished_at = CURRENT_TIMESTAMP,
       to_ext = COALESCE(?, to_ext)
     WHERE id = ? AND session_id = ?`,
    [status, outputs.length, outputBytes, num(p.duration_ms), str(p.error, 1000), outputs.length ? str((outputs[0].ext || '').toLowerCase(), 16) : null, num(id), sid]);
  if (r?.affectedRows && outputs.length) {
    await safe('INSERT INTO files (session_id, conversion_id, role, name, ext, mime, size_bytes) VALUES ?',
      [outputs.map(f => [sid, num(id), 'output', str(f.name, 512) || 'file', str((f.ext || '').toLowerCase(), 16), str(f.mime, 128), num(f.size)])]);
  }
  return r?.affectedRows || 0;
}

// ---------- archive helpers ----------
/** Find (or create) the files row for an archived upload and attach the local path. Returns the row id. */
export async function attachArchive(sid, { conversion_id, role, name, ext, mime, size, storage_path }) {
  if (!isUuid(sid) || !conversion_id) return null;
  const r = role === 'output' ? 'output' : 'input';
  const rows = await safe('SELECT id FROM files WHERE conversion_id = ? AND session_id = ? AND role = ? AND name = ? AND storage_path IS NULL ORDER BY id LIMIT 1', [num(conversion_id), sid, r, str(name, 512)]);
  let id = rows?.[0]?.id;
  if (!id) {
    const ins = await safe('INSERT INTO files (session_id, conversion_id, role, name, ext, mime, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sid, num(conversion_id), r, str(name, 512) || 'file', str((ext || '').toLowerCase(), 16), str(mime, 128), num(size)]);
    id = ins?.insertId;
  }
  if (!id) return null;
  await safe('UPDATE files SET storage_path = ?, archived_at = CURRENT_TIMESTAMP, size_bytes = GREATEST(size_bytes, ?) WHERE id = ?', [str(storage_path, 512), num(size), id]);
  return id;
}
export const setDriveInfo = (fileId, { drive_file_id, drive_url }) => safe('UPDATE files SET drive_file_id = ?, drive_url = ? WHERE id = ?', [str(drive_file_id, 128), str(drive_url, 255), num(fileId)]);
export const pendingDriveUploads = () => safe('SELECT id, storage_path FROM files WHERE storage_path IS NOT NULL AND drive_url IS NULL ORDER BY id LIMIT 500');
export const getFile = id => safe('SELECT id, conversion_id, role, name, mime, size_bytes, storage_path, drive_url FROM files WHERE id = ?', [num(id)]).then(r => r?.[0] || null);
export const clearExpiredArchive = days => safe('UPDATE files SET storage_path = NULL, drive_file_id = NULL, drive_url = NULL WHERE archived_at < NOW() - INTERVAL ? DAY AND storage_path IS NOT NULL', [num(days)]);
export const filesForConversions = ids => (ids?.length ? safe('SELECT id, conversion_id, role, name, size_bytes, storage_path IS NOT NULL AS local, drive_url FROM files WHERE conversion_id IN (?) ORDER BY id', [ids.map(num)]) : Promise.resolve([]));
export const archiveTotals = () => safe(`SELECT COUNT(*) AS archived, SUM(drive_url IS NOT NULL) AS on_drive, COALESCE(SUM(size_bytes),0) AS bytes FROM files WHERE storage_path IS NOT NULL`).then(r => r?.[0] || {});

// ---------- read helpers (public counters + admin dashboard) ----------
let publicCache = { at: 0, data: null };
export async function publicStats() {
  if (Date.now() - publicCache.at < 30000 && publicCache.data) return publicCache.data;
  const [tot] = (await safe(`SELECT COUNT(*) AS conversions, COALESCE(SUM(input_count),0) AS files, COALESCE(SUM(input_bytes),0) AS bytes,
      COUNT(DISTINCT session_id) AS users FROM conversions WHERE status = 'success'`)) || [{}];
  const top = (await safe(`SELECT tool_id, COUNT(*) AS runs FROM conversions WHERE status = 'success' AND started_at > NOW() - INTERVAL 30 DAY GROUP BY tool_id ORDER BY runs DESC LIMIT 8`)) || [];
  const data = { conversions: Number(tot?.conversions || 0), files: Number(tot?.files || 0), bytes: Number(tot?.bytes || 0), users: Number(tot?.users || 0), trending: top.map(r => r.tool_id) };
  publicCache = { at: Date.now(), data };
  return data;
}

export async function adminSummary(days = 14) {
  const d = Math.min(365, Math.max(1, num(days) || 14));
  const q = async (sql, params) => (await safe(sql, params)) || [];
  const [totals] = await q(`SELECT
      (SELECT COUNT(*) FROM sessions) AS sessions,
      (SELECT COUNT(*) FROM page_views) AS page_views,
      (SELECT COUNT(*) FROM conversions) AS conversions,
      (SELECT COUNT(*) FROM conversions WHERE status='success') AS successful,
      (SELECT COUNT(*) FROM conversions WHERE status='error') AS failed,
      (SELECT COALESCE(SUM(input_bytes),0) FROM conversions) AS input_bytes,
      (SELECT COALESCE(SUM(output_bytes),0) FROM conversions) AS output_bytes,
      (SELECT COUNT(*) FROM files WHERE role='input') AS files_uploaded,
      (SELECT COUNT(*) FROM downloads) AS downloads,
      (SELECT COUNT(*) FROM ai_requests) AS ai_requests,
      (SELECT COUNT(*) FROM feedback) AS feedback,
      (SELECT ROUND(AVG(rating),2) FROM feedback WHERE rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM error_logs) AS errors,
      (SELECT COUNT(*) FROM sessions WHERE last_seen > NOW() - INTERVAL 5 MINUTE) AS online_now,
      (SELECT COUNT(*) FROM conversions WHERE started_at > CURDATE()) AS today`);
  // Recursive CTE = one row per calendar day, so quiet days show as 0 instead of disappearing from the chart
  const daily = await q(`WITH RECURSIVE nums AS (SELECT 0 AS n UNION ALL SELECT n + 1 FROM nums WHERE n < ${d - 1})
    SELECT DATE_FORMAT(CURDATE() - INTERVAL n DAY, '%Y-%m-%d') AS day, COALESCE(c.conversions,0) AS conversions, COALESCE(c.successful,0) AS successful,
      COALESCE(c.failed,0) AS failed, COALESCE(c.unique_users,0) AS unique_users, COALESCE(c.input_mb,0) AS input_mb
    FROM nums LEFT JOIN v_daily_summary c ON c.day = CURDATE() - INTERVAL n DAY ORDER BY day`);
  const tools = await q('SELECT * FROM v_tool_popularity LIMIT 15');
  const pairs = await q('SELECT * FROM v_format_pairs LIMIT 12');
  const hourly = await q('SELECT * FROM v_hourly_activity');
  const recent = await q('SELECT * FROM v_recent_activity LIMIT 25');
  const devices = await q('SELECT device, COUNT(*) AS n FROM sessions GROUP BY device ORDER BY n DESC');
  const browsers = await q('SELECT browser, COUNT(*) AS n FROM sessions GROUP BY browser ORDER BY n DESC LIMIT 6');
  const searches = await q('SELECT query, COUNT(*) AS n, SUM(results = 0) AS no_results FROM searches GROUP BY query ORDER BY n DESC LIMIT 12');
  const missing = await q('SELECT * FROM v_missing_tools LIMIT 10');
  const ai = await q(`SELECT feature, COUNT(*) AS n, SUM(status='success') AS ok, ROUND(AVG(duration_ms)/1000,1) AS avg_s FROM ai_requests GROUP BY feature ORDER BY n DESC`);
  const errors = await q('SELECT id, created_at, source, tool_id, LEFT(message, 160) AS message FROM error_logs ORDER BY id DESC LIMIT 12');
  const fb = await q('SELECT id, created_at, tool_id, rating, LEFT(comment, 200) AS comment FROM feedback ORDER BY id DESC LIMIT 10');
  const locations = await q('SELECT location, COUNT(*) AS n FROM conversions GROUP BY location');
  const recentFiles = await filesForConversions(recent.map(r => r.id)) || [];
  for (const r of recent) r.files = recentFiles.filter(f => f.conversion_id === r.id);
  return { generated_at: new Date().toISOString(), days: d, totals: totals || {}, daily, tools, pairs, hourly, recent, devices, browsers, searches, missing, ai, errors, feedback: fb, locations };
}

export async function closeDb() { if (pool) await pool.end().catch(() => {}); }
