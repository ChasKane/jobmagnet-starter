const fs = require('fs');
const path = require('path');

let envLoaded = false;

function loadEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const file = path.join(__dirname, '..', '..', '.env');
  try {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (_) {}
}

/** sqlite until MAGNET_STORE=supabase. Supabase is HTTP (SUPABASE_URL + service role), not a Postgres socket. */
function storeMode() {
  loadEnv();
  if (process.env.NODE_TEST_CONTEXT && process.env.MAGNET_STORE_TEST !== 'supabase') return 'sqlite';
  const flag = String(process.env.MAGNET_STORE || '').trim().toLowerCase();
  if (flag === 'supabase') return 'supabase';
  return 'sqlite';
}

function isSupabase() {
  return storeMode() === 'supabase';
}

module.exports = { loadEnv, storeMode, isSupabase };
