const { isSupabase } = require('./mode');
const rest = require('./rest');

const LOG_TABLES = new Set([
  'essay_commits',
  'answer_commits',
  'autofill_attempts',
  'llm_log',
  'timing_events',
]);

function restSelect(table, query = '') {
  if (!rest.config().ready) return null;
  return rest.select(table, query);
}

function restInsert(table, row) {
  if (!rest.config().ready) return false;
  rest.insert(table, row, { returning: false });
  return true;
}

function insert(table, row) {
  if (!isSupabase()) return false;
  if (!LOG_TABLES.has(table)) throw new Error(`unknown log table ${table}`);
  const clean = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (value !== undefined) clean[key] = value;
  }
  if (!restInsert(table, clean)) {
    throw new Error('MAGNET_STORE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return true;
}

module.exports = { insert, restSelect };
