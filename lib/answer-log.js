/** Append-only log of every filled question on an application, keyed by listing URL. */

const fs = require('fs');
const path = require('path');
const { normalizeQuestion } = require('./normalize');
const { usefulCurrent } = require('./essay-prompt');
const { isSupabase } = require('./store/mode');

const ESSAY_MIN = 40;
const seen = new Set();

function inTest() {
  const args = [...process.execArgv, ...process.argv];
  return args.some((arg) => arg === '--test' || String(arg).endsWith('.test.js'));
}

function fieldsPath() {
  if (process.env.MAGNET_ANSWERS_LOG) return process.env.MAGNET_ANSWERS_LOG;
  const root = process.env.MAGNET_KNOWLEDGE || path.join(__dirname, '..', 'knowledge');
  return path.join(root, 'archive', 'fields.jsonl');
}

function skipField(field) {
  if (!field || typeof field !== 'object') return true;
  const type = String(field.type || '').toLowerCase();
  if (type === 'password' || type === 'file' || type === 'hidden') return true;
  if (field.route === 'skip' && field.reason === 'chrome') return true;
  const blob = `${field.id || ''} ${field.label || ''} ${field.name || ''}`;
  if (/recaptcha|cf-turnstile|h-?captcha|g-recaptcha/i.test(blob)) return true;
  return false;
}

function fieldValue(field) {
  return usefulCurrent(
    field.final != null && String(field.final).trim()
      ? field.final
      : field.value != null && String(field.value).trim()
        ? field.value
        : field.current != null && String(field.current).trim()
          ? field.current
          : field.intended != null && String(field.intended).trim()
            ? field.intended
            : field.llm_draft || ''
  );
}

function isEssayish(field, value) {
  if (field.kind === 'essay' || field.route === 'needs_llm') return String(value || '').trim().length > 0;
  if (field.tag === 'textarea' || field.contenteditable) return String(value || '').trim().length >= ESSAY_MIN;
  return String(value || '').trim().length >= ESSAY_MIN;
}

function describeAnswer(field, meta) {
  if (skipField(field)) return null;
  const value = fieldValue(field);
  if (!value) return null;
  const url = (meta && meta.url) || field.url || '';
  if (!url) return null;
  const label = String(field.label || field.normalized_key || '').trim();
  if (!label) return null;
  const kind = isEssayish(field, value) ? 'essay' : 'static';
  return {
    ts: new Date().toISOString(),
    company: String((meta && (meta.company || meta.name)) || field.company || '').trim(),
    url,
    label,
    value,
    field_id: String(field.id || field.field_id || ''),
    kind,
    origin: String(field.origin || (kind === 'essay' ? 'magnet' : 'autofill')),
    route: String(field.route || ''),
    normalized_key: field.normalized_key || normalizeQuestion(label),
    llm_draft: field.llm_draft != null ? String(field.llm_draft) : '',
  };
}

function collectAnswers(groups, meta) {
  const byKey = new Map();
  for (const group of groups || []) {
    for (const field of group || []) {
      const row = describeAnswer(field, meta);
      if (!row) continue;
      const key = `${row.url}\u0001${row.field_id}\u0001${row.label}`;
      const prev = byKey.get(key);
      if (!prev || row.value.length >= prev.value.length) byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

function fingerprint(row) {
  return [row.url, row.field_id, row.label, row.value].join('\u0001');
}

function appendFile(row) {
  const file = fieldsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

function rememberRemoteAnswer(row) {
  if (!isSupabase()) return false;
  const { insert } = require('./store/remote-log');
  insert('answer_commits', {
    ts: row.ts,
    company: row.company,
    url: row.url,
    label: row.label,
    value: row.value,
    field_id: row.field_id,
    kind: row.kind,
    origin: row.origin,
    route: row.route,
    normalized_key: row.normalized_key,
  });
  return true;
}

function persistAnswer(row) {
  const key = fingerprint(row);
  if (seen.has(key)) return row;
  seen.add(key);
  if (inTest() && !process.env.MAGNET_ANSWERS_LOG) return row;
  let remote = false;
  try {
    remote = rememberRemoteAnswer(row);
  } catch (err) {
    console.warn('[magnet] answer log:', (err && err.message) || err);
  }
  if (!remote) appendFile(row);
  return row;
}

function recordAnswers(fields, meta) {
  const rows = collectAnswers([fields], meta);
  for (const row of rows) persistAnswer(row);
  return rows;
}

function readJsonl(file) {
  try {
    if (!file || !fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function loadLoggedAnswers() {
  if (isSupabase()) {
    try {
      const { restSelect } = require('./store/remote-log');
      const rows = restSelect(
        'answer_commits',
        'select=ts,company,url,label,value,field_id,kind,origin,route,normalized_key&order=id&limit=5000'
      );
      if (rows) return rows;
    } catch (err) {
      console.warn('[magnet] answer log:', (err && err.message) || err);
    }
    try {
      const store = require('./store');
      store.open();
      return store.query(
        'SELECT ts, company, url, label, value, field_id, kind, origin, route, normalized_key FROM answer_commits ORDER BY id'
      );
    } catch (err) {
      console.warn('[magnet] answer log:', (err && err.message) || err);
      return readJsonl(fieldsPath());
    }
  }
  return readJsonl(fieldsPath());
}

async function harvestViaControl(opts = {}) {
  const base = process.env.MAGNET_URL || 'http://127.0.0.1:3871';
  const url = opts.url || '';
  if (!url) return { ok: false, error: 'url required' };
  try {
    const res = await fetch(`${base}/harvest-answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, company: opts.company || '', title: opts.title || '' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, ...json };
    return json;
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

module.exports = {
  ESSAY_MIN,
  skipField,
  fieldValue,
  isEssayish,
  describeAnswer,
  collectAnswers,
  recordAnswers,
  loadLoggedAnswers,
  harvestViaControl,
  fieldsPath,
};
