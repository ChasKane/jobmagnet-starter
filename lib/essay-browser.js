/** List, filter, and sort logged essays for the popup and CLI. */

const ORIGIN_RANK = { rewrite: 3, applicant: 3, edit: 2, magnet: 1 };

function asBool(value, fallback = true) {
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return fallback;
}

function normalize(row) {
  const src = row && typeof row === 'object' ? row : {};
  const text = String(src.final || src.text || src.llm_draft || '').trim();
  return {
    ts: src.ts ? String(src.ts) : '',
    company: String(src.company || '').trim(),
    url: String(src.url || '').trim(),
    label: String(src.label || src.normalized_key || '').trim(),
    text,
    draft: String(src.llm_draft || '').trim(),
    origin: String(src.origin || '').trim(),
    unchanged: Boolean(src.unchanged),
    score: Number(src.score) || 0,
  };
}

function essayKey(row) {
  return `${row.url || ''}::${String(row.label || '').toLowerCase()}`;
}

function isBetter(next, prev) {
  if (!prev) return true;
  if (String(next.ts) !== String(prev.ts)) return String(next.ts) > String(prev.ts);
  if ((next.score || 0) !== (prev.score || 0)) return (next.score || 0) > (prev.score || 0);
  return (ORIGIN_RANK[next.origin] || 0) >= (ORIGIN_RANK[prev.origin] || 0);
}

function uniqueLatest(rows) {
  const by = new Map();
  for (const row of rows) {
    const key = essayKey(row);
    if (isBetter(row, by.get(key))) by.set(key, row);
  }
  return [...by.values()];
}

function sortEssays(rows, sort) {
  const key = String(sort || 'ts').toLowerCase();
  const copy = rows.slice();
  copy.sort((a, b) => {
    if (key === 'company') return a.company.localeCompare(b.company) || String(b.ts).localeCompare(String(a.ts));
    if (key === 'label' || key === 'question') {
      return a.label.localeCompare(b.label) || String(b.ts).localeCompare(String(a.ts));
    }
    if (key === 'length') return (b.text.length || 0) - (a.text.length || 0);
    if (key === 'ts-asc' || key === 'oldest') return String(a.ts).localeCompare(String(b.ts));
    return String(b.ts).localeCompare(String(a.ts));
  });
  return copy;
}

function matches(row, opts) {
  const company = String(opts.company || '')
    .trim()
    .toLowerCase();
  if (company && !row.company.toLowerCase().includes(company)) return false;
  const q = String(opts.q || opts.query || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  return `${row.company} ${row.label} ${row.text}`.toLowerCase().includes(q);
}

function asAnswerRow(row) {
  if (!row || typeof row !== 'object') return row;
  if (row.final != null || row.llm_draft != null || row.text != null) return row;
  return { ...row, final: row.value || '', text: row.value || '' };
}

function listEssays(opts = {}, sourceRows) {
  const unique = asBool(opts.unique, true);
  const includeAll = asBool(opts.all, false);
  const min = Math.max(0, Number(opts.min));
  const minLen = Number.isFinite(Number(opts.min)) ? min : includeAll ? 0 : 40;
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 50));
  let raw;
  if (Array.isArray(sourceRows)) raw = sourceRows;
  else if (includeAll) raw = require('./answer-log').loadLoggedAnswers().map(asAnswerRow);
  else raw = require('./essay-log').loadLoggedEssays();
  const rows = raw.map(asAnswerRow).map(normalize).filter((row) => row.label && row.text.length >= minLen);
  const companies = [...new Set(rows.map((row) => row.company).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  let pool = rows.filter((row) => matches(row, opts));
  if (unique) pool = uniqueLatest(pool);
  pool = sortEssays(pool, opts.sort);
  return {
    total: pool.length,
    unique,
    essays: pool.slice(0, limit),
    companies,
  };
}

function optionsFromArgv(argv) {
  const opts = {};
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const next = args[i + 1];
    if (flag === '--q' || flag === '--query') opts.q = next;
    else if (flag === '--company') opts.company = next;
    else if (flag === '--sort') opts.sort = next;
    else if (flag === '--limit') opts.limit = next;
    else if (flag === '--min') opts.min = next;
    else if (flag === '--all') opts.unique = false;
    else if (flag === '--answers' || flag === '--all-answers') opts.all = true;
    else if (flag === '--json') opts.format = 'json';
    else continue;
    if (flag !== '--all' && flag !== '--json' && flag !== '--answers' && flag !== '--all-answers') i += 1;
  }
  return opts;
}

function formatEssayText(result) {
  const rows = (result && result.essays) || [];
  if (!rows.length) return 'No essays matched.';
  return rows
    .map((row, i) => {
      const when = String(row.ts || '').slice(0, 10) || 'undated';
      const who = row.company || 'Unknown';
      return `${i + 1}. ${who} · ${when}\nQ: ${row.label}\n\n${row.text}`;
    })
    .join('\n\n---\n\n');
}

function printEssays(opts = {}, sourceRows) {
  const query = { limit: 20, ...opts };
  const result = listEssays(query, sourceRows);
  if (query.format === 'json') return JSON.stringify(result, null, 2);
  return formatEssayText(result);
}

module.exports = {
  listEssays,
  normalize,
  uniqueLatest,
  essayKey,
  optionsFromArgv,
  formatEssayText,
  printEssays,
};
