// Creates the ConvertHub database (tables + views) on any MySQL 8 server and verifies the login —
// without starting the website. Uses the DB_* values from .env; every one can be overridden:
//
//   npm run db:init                                      → whatever .env says
//   npm run db:init -- --db live_converter               → same server, different database
//   npm run db:init -- --host 192.168.90.223 --user sfc_app --password ****** --db live_converter
//   DATABASE_URL="mysql://user:pass@host:3306/live_converter?ssl=true" npm run db:init
//
// Exit code 0 = database ready. Prints the exact Navicat connection details at the end.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../src/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, env) => { const i = args.indexOf(`--${name}`); if (i > -1 && args[i + 1] !== undefined) process.env[env] = args[i + 1]; };
flag('host', 'DB_HOST'); flag('port', 'DB_PORT'); flag('user', 'DB_USER'); flag('password', 'DB_PASSWORD'); flag('db', 'DB_NAME'); flag('url', 'DATABASE_URL');
if (args.includes('--ssl')) process.env.DB_SSL = 'true';
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: npm run db:init -- [--host H] [--port P] [--user U] [--password PW] [--db NAME] [--ssl] [--url mysql://…]');
  process.exit(0);
}
loadEnvFile(path.join(root, '.env'));
process.env.DB_ENABLED = 'true';

const db = await import('../src/db.js');
const c = db.dbConfig();
console.log(`\nConvertHub DB setup → ${c.user}@${c.host}:${c.port}/${c.database}${c.ssl ? ' (TLS)' : ''}\n`);
const t0 = Date.now();
const ok = await db.initDb();
if (!ok) {
  console.error(`\n✗ Could not set up the database: ${db.dbStatus().error}`);
  console.error('  • Wrong host/port? Not on the office network / VPN? Firewall on 3306?');
  console.error('  • Wrong user/password? Try the same values in Navicat first.');
  console.error('  • "Access denied ... to database": ask the DBA to run deploy/live_converter.sql once, then re-run this.');
  await db.closeDb();
  process.exit(1);
}
const tables = (await db.listObjects?.()) || null;
console.log(`✓ Database ready in ${Date.now() - t0} ms${tables ? ` — ${tables.tables} tables, ${tables.views} views` : ''}`);
console.log(`
Navicat → New Connection → MySQL
  Connection name : ${c.database}
  Host            : ${c.host}
  Port            : ${c.port}
  User            : ${c.user}
  Password        : (the one you just used)
  Database        : ${c.database}${c.ssl ? '\n  SSL             : ON (tab "SSL" → Use SSL)' : ''}

Website .env     : DB_HOST=${c.host}  DB_PORT=${c.port}  DB_USER=${c.user}  DB_NAME=${c.database}${c.ssl ? '  DB_SSL=true' : ''}
`);
await db.closeDb();
