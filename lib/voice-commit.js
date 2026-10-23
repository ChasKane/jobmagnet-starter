const fs = require('fs');
const path = require('path');

const ANSWERS = path.join(__dirname, '..', 'knowledge', 'archive', 'answers.jsonl');

function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

function commitVoice(tab, session) {
  const { recordEssay } = require('./essay-log');
  const fields = (session && session.fields) || [];
  const rows = [];
  for (const f of fields) {
    const row = recordEssay({
      company: tab.meta && tab.meta.name,
      url: tab.meta && tab.meta.url,
      label: f.label,
      normalized_key: f.normalized_key,
      llm_draft: f.llm_draft || '',
      final: f.final || f.llm_draft || '',
      source_card_ids: Array.isArray(f.source_card_ids) ? f.source_card_ids : [],
      id: f.id,
    });
    if (row) rows.push(row);
  }
  try {
    const { compileFinals } = require('./compile');
    Promise.resolve(compileFinals(rows)).catch((err) => {
      console.warn('[magnet] compile finals:', (err && err.message) || err);
    });
  } catch (_) {}
  return rows;
}

function sourceCardIds(row) {
  const raw = (row && row.source_card_ids) || [];
  return (Array.isArray(raw) ? raw : []).map(String).filter(Boolean);
}

function bindShippedMagnet(rows) {
  const graph = require('./graph');
  const { inferShape } = require('./cascade');
  graph.ensureOpen();
  const out = [];
  for (const row of rows || []) {
    if (!row || row.origin !== 'magnet') continue;
    const ids = sourceCardIds(row);
    if (!ids.length) continue;
    const shape = inferShape([{ label: row.label || row.normalized_key || '' }], '');
    for (const card_id of ids) {
      const made = graph.addBinding({
        question_shape: shape,
        card_id,
        source: 'complete-unchanged',
      });
      if (made && made.kind !== 'no-op') out.push(made);
    }
  }
  return out;
}

module.exports = { commitVoice, bindShippedMagnet, appendJsonl, ANSWERS };
