/** Durable mid-hunt session. Jobs stay in SQLite; this remembers in-run progress. */

const { normalizeSchema, MAX_N } = require('../packages/core/src/search-schema');

function planKey(schema) {
  const s = normalizeSchema(schema || {});
  return JSON.stringify({
    n: s.n,
    sites: s.sites || [],
    titleIncludes: s.titleIncludes || [],
    keywords: s.keywords || [],
    remote: s.remote,
    salaryMin: s.salaryMin,
    maxAgeDays: s.maxAgeDays,
    company: s.company || '',
    excludeIndustries: s.excludeIndustries || [],
  });
}

function uniqUrls(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const url = String(raw || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function resolveNeed(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) continue;
    return Math.min(MAX_N, Math.round(n));
  }
  return null;
}

function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const schema = raw.schema && typeof raw.schema === 'object' ? raw.schema : null;
  const added = uniqUrls(raw.added || raw.urls);
  const have = uniqUrls([...(raw.have || []), ...added]);
  const jobs = Array.isArray(raw.jobs) ? raw.jobs.filter((j) => j && j.url) : [];
  const need = resolveNeed(raw.need, schema && schema.n);
  const status = String(raw.status || 'running');
  return {
    schema,
    planKey: raw.planKey || (schema ? planKey(schema) : ''),
    starts: Array.isArray(raw.starts) ? raw.starts.filter((s) => s && s.url) : [],
    added,
    have,
    jobs,
    dupes: Number(raw.dupes) || 0,
    jds: Number(raw.jds) || 0,
    need,
    href: String(raw.href || '').trim(),
    jsonDone: Boolean(raw.jsonDone),
    round: Math.max(0, Number(raw.round) || 0),
    last: String(raw.last || ''),
    status: status === 'done' || status === 'cancelled' ? status : 'running',
    updatedAt: raw.updatedAt || '',
  };
}

function isOpenSession(session) {
  if (!session) return false;
  if (session.status === 'done') return false;
  return session.need != null && session.added.length < session.need;
}

function canResume(session, schema) {
  const row = normalizeSession(session);
  if (!isOpenSession(row)) return false;
  if (!schema) return true;
  return row.planKey === planKey(schema);
}

function snapshotSession(state, extra = {}) {
  const schema = extra.schema || (state && state.schema) || null;
  const added = uniqUrls((state && state.added) || extra.added || []);
  const have = state && state.have instanceof Set ? [...state.have] : extra.have || added;
  return normalizeSession({
    schema,
    planKey: schema ? planKey(schema) : extra.planKey || '',
    starts: extra.starts || (state && state.starts) || [],
    added,
    have,
    jobs: (state && state.jobs) || extra.jobs || [],
    dupes: state && state.dupes != null ? state.dupes : extra.dupes || 0,
    jds: state && state.jds != null ? state.jds : extra.jds || 0,
    need: resolveNeed(extra.need, state && state.need, schema && schema.n),
    href: extra.href != null ? extra.href : (state && state.href) || '',
    jsonDone: extra.jsonDone != null ? extra.jsonDone : Boolean(state && state.jsonDone),
    round: extra.round != null ? extra.round : (state && state.round) || 0,
    last: extra.last != null ? extra.last : (state && state.last) || '',
    status: extra.status || (state && state.status) || 'running',
    updatedAt: extra.updatedAt || new Date().toISOString(),
  });
}

function restoreState(session) {
  const row = normalizeSession(session);
  if (!row) {
    return {
      added: [],
      jobs: [],
      have: new Set(),
      dupes: 0,
      jds: 0,
      need: null,
      loginWait: null,
      schema: null,
      starts: [],
      href: '',
      jsonDone: false,
      round: 0,
      last: '',
      status: 'running',
      resumed: false,
    };
  }
  return {
    added: row.added.slice(),
    jobs: row.jobs.slice(),
    have: new Set(row.have),
    dupes: row.dupes,
    jds: row.jds,
    need: row.need,
    loginWait: null,
    schema: row.schema,
    starts: row.starts.slice(),
    href: row.href,
    jsonDone: row.jsonDone,
    round: row.round,
    last: row.last,
    status: row.status,
    resumed: false,
  };
}

function resumeHint(session, schema) {
  const row = normalizeSession(session);
  if (!canResume(row, schema)) return null;
  return {
    added: row.added.length,
    need: row.need,
    href: row.href,
    jsonDone: row.jsonDone,
    round: row.round,
  };
}

module.exports = {
  planKey,
  normalizeSession,
  isOpenSession,
  canResume,
  snapshotSession,
  restoreState,
  resumeHint,
};
