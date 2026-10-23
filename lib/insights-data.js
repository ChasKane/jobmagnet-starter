/** Load JobMagnet applications, mail, and essays, and persist the insights layout. */

const fs = require('fs');
const path = require('path');
const { buildInsights, normalizeConfig } = require('./insights');

function configFile() {
  const root = process.env.MAGNET_KNOWLEDGE || path.join(__dirname, '..', 'knowledge');
  return path.join(root, 'insights.json');
}

function readConfig() {
  try {
    const file = configFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('[magnet] insights config:', (err && err.message) || err);
    return null;
  }
}

function writeConfig(config) {
  const next = normalizeConfig(config);
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

function defaultLoadJobs() {
  const persist = require('../packages/persist');
  persist.open();
  const api = persist.nodeStore();
  const listed = api.listJobs() || [];
  const briefs = typeof api.processBriefs === 'function' ? api.processBriefs(listed.map((job) => job.url)) : null;
  let processRows = null;
  if (!briefs) {
    try {
      const store = require('./store');
      store.open();
      processRows = new Map(
        (store.query('SELECT url, status, submitted_at, essays FROM process_records') || []).map((row) => [row.url, row])
      );
    } catch (err) {
      console.warn('[magnet] insights applications:', (err && err.message) || err);
      processRows = new Map();
    }
  }
  const jobs = [];
  const essays = [];
  for (const job of listed) {
    const rec = briefs ? briefs.get(job.url) || {} : (processRows && processRows.get(job.url)) || {};
    jobs.push({
      url: job.url,
      title: job.title || '',
      company: job.company || job.name || '',
      level: job.level || '',
      status: rec.status || job.status || 'open',
      submitted_at: rec.submitted_at || job.submitted_at || '',
    });
    if (briefs || !rec.essays) continue;
    let stored = [];
    try {
      stored = typeof rec.essays === 'string' ? JSON.parse(rec.essays || '[]') : rec.essays;
    } catch (_) {
      stored = [];
    }
    if (!Array.isArray(stored)) continue;
    for (const essay of stored) {
      essays.push({
        ...essay,
        url: job.url,
        company: job.company || job.name || '',
        ts: (essay && essay.ts) || rec.submitted_at || '',
      });
    }
  }
  return { jobs, processEssays: essays };
}

function loadSnapshot(deps) {
  const hooks = deps && typeof deps === 'object' ? deps : {};
  const loaded = hooks.loadJobs ? hooks.loadJobs() : defaultLoadJobs();
  const jobs = (loaded && loaded.jobs) || [];
  const essays = [];
  const seen = new Set();
  function take(row) {
    if (!row || typeof row !== 'object') return;
    const text = String(row.final || row.text || row.llm_draft || '').trim();
    if (!text) return;
    const key = `${row.url || ''}\u0001${row.label || ''}\u0001${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    essays.push(row);
  }
  try {
    const rows = hooks.loadEssays ? hooks.loadEssays() : require('./essay-log').loadLoggedEssays();
    for (const row of rows || []) take(row);
  } catch (err) {
    console.warn('[magnet] insights essays:', (err && err.message) || err);
  }
  for (const row of (loaded && loaded.processEssays) || []) take(row);

  const mail = [];
  try {
    const index = hooks.loadIndex ? hooks.loadIndex() : require('./mail/cache').loadIndex();
    for (const [id, row] of Object.entries(index || {})) {
      if (!row || typeof row !== 'object') continue;
      mail.push({ id, ...row });
    }
  } catch (err) {
    console.warn('[magnet] insights mail:', (err && err.message) || err);
  }
  return { jobs, mail, essays };
}

function insightsPayload(config, deps) {
  const stored = config === undefined ? readConfig() : config;
  return buildInsights(loadSnapshot(deps), stored);
}

module.exports = { configFile, readConfig, writeConfig, loadSnapshot, insightsPayload };
