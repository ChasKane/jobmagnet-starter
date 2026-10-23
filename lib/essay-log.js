const fs = require('fs');
const path = require('path');
const { rankAnswer } = require('./answer-rank');
const { isSupabase } = require('./store/mode');

const seen = new Set();
const MACHINE_ORIGINS = new Set(['autofill', 'harvest', 'profile', 'agent']);

function inTest() {
  const args = [...process.execArgv, ...process.argv];
  return args.some((arg) => arg === '--test' || String(arg).endsWith('.test.js'));
}

function answersPath() {
  if (process.env.MAGNET_ANSWERS) return process.env.MAGNET_ANSWERS;
  const root = process.env.MAGNET_KNOWLEDGE || path.join(__dirname, '..', 'knowledge');
  return path.join(root, 'archive', 'answers.jsonl');
}

function describeEssay(partial) {
  const draft = partial && partial.llm_draft != null ? String(partial.llm_draft) : '';
  const finalText = partial && partial.final != null ? String(partial.final) : draft;
  if (!draft.trim() && !finalText.trim()) return null;
  const unchanged = draft === finalText;
  const ranked = rankAnswer({ llm_draft: draft, final: finalText, unchanged });
  return {
    ts: new Date().toISOString(),
    company: (partial && partial.company) || '',
    url: (partial && partial.url) || '',
    label: (partial && partial.label) || '',
    normalized_key: (partial && partial.normalized_key) || '',
    llm_draft: draft,
    final: finalText,
    unchanged,
    origin: (partial && partial.origin) || ranked.origin,
    overlap: ranked.overlap,
    score: ranked.score,
    source_card_ids: Array.isArray(partial && partial.source_card_ids) ? partial.source_card_ids : [],
    field_id: (partial && (partial.id || partial.field_id)) || '',
  };
}

function fingerprint(row) {
  return [row.url, row.field_id, row.label, row.llm_draft, row.final].join('\u0001');
}

function appendFile(row) {
  const file = answersPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

function rememberOnApplication(row) {
  if (!row.url) return;
  try {
    const persist = require('../packages/persist');
    persist.open();
    const api = persist.nodeStore();
    const rec = api.getProcess(row.url);
    const essays = Array.isArray(rec.essays) ? rec.essays.slice() : [];
    const idx = essays.findIndex(
      (essay) =>
        (row.field_id && (essay.id === row.field_id || essay.field_id === row.field_id)) ||
        (row.normalized_key && essay.normalized_key === row.normalized_key) ||
        (row.label && essay.label === row.label)
    );
    const next = {
      id: row.field_id,
      label: row.label,
      normalized_key: row.normalized_key,
      llm_draft: row.llm_draft,
      final: row.final,
      origin: row.origin,
      source_card_ids: row.source_card_ids,
    };
    if (idx >= 0) essays[idx] = { ...essays[idx], ...next };
    else essays.push(next);
    api.writeProcess(row.url, { essays });
  } catch (err) {
    console.warn('[magnet] essay application:', (err && err.message) || err);
  }
}

function rememberRemote(row) {
  if (!isSupabase()) return false;
  const { insert } = require('./store/remote-log');
  insert('essay_commits', {
    ts: row.ts,
    company: row.company,
    url: row.url,
    label: row.label,
    normalized_key: row.normalized_key,
    llm_draft: row.llm_draft,
    final: row.final,
    unchanged: row.unchanged,
    origin: row.origin,
    overlap: row.overlap,
    score: row.score,
    source_card_ids: row.source_card_ids,
  });
  return true;
}

/** Append a draft or final as soon as it exists. Complete is not required. */
function recordEssay(partial) {
  if (partial && MACHINE_ORIGINS.has(String(partial.origin || ''))) return null;
  const row = describeEssay(partial);
  if (!row || !row.url) return row;
  if (inTest() && !process.env.MAGNET_ANSWERS) return row;
  const key = fingerprint(row);
  if (seen.has(key)) return row;
  seen.add(key);
  let remote = false;
  try {
    remote = rememberRemote(row);
  } catch (err) {
    console.warn('[magnet] essay log:', (err && err.message) || err);
  }
  if (!remote) appendFile(row);
  rememberOnApplication(row);
  return row;
}

function recordSession(session, meta) {
  const fields = (session && session.fields) || [];
  const rows = [];
  for (const field of fields) {
    const row = recordEssay({
      ...field,
      company: meta && (meta.company || meta.name),
      url: meta && meta.url,
    });
    if (row) rows.push(row);
  }
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

function loadLoggedEssays() {
  if (isSupabase()) {
    try {
      const { restSelect } = require('./store/remote-log');
      const rows = restSelect(
        'essay_commits',
        'select=ts,company,url,label,normalized_key,llm_draft,final,unchanged,origin,overlap,score,source_card_ids&order=id&limit=2000'
      );
      if (rows) return rows;
    } catch (err) {
      console.warn('[magnet] essay log:', (err && err.message) || err);
    }
    try {
      const store = require('./store');
      store.open();
      return store.query(
        'SELECT ts, company, url, label, normalized_key, llm_draft, final, unchanged, origin, overlap, score, source_card_ids FROM essay_commits ORDER BY id'
      );
    } catch (err) {
      console.warn('[magnet] essay log:', (err && err.message) || err);
      return readJsonl(answersPath());
    }
  }
  return readJsonl(answersPath());
}

module.exports = { recordEssay, recordSession, loadLoggedEssays, answersPath, describeEssay, MACHINE_ORIGINS };
