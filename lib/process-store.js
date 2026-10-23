const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { isAgentJob } = require('./jobs-file');

const PROCESS_FILE = path.join(__dirname, '..', 'knowledge', 'process.yaml');

let cached = null;
let cachedPath = '';

function processFile() {
  if (process.env.MAGNET_KNOWLEDGE) return path.join(process.env.MAGNET_KNOWLEDGE, 'process.yaml');
  return PROCESS_FILE;
}

function persistApi() {
  const persist = require('../packages/persist');
  persist.open();
  return persist.nodeStore();
}

function invalidate() {
  cached = null;
  cachedPath = '';
}

function loadProcess() {
  const file = processFile();
  if (cached && cachedPath === file) return cached;
  try {
    if (!fs.existsSync(file)) {
      cached = { by_url: {} };
      cachedPath = file;
      return cached;
    }
    const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    if (!doc.by_url || typeof doc.by_url !== 'object') doc.by_url = {};
    cached = doc;
    cachedPath = file;
    return cached;
  } catch (err) {
    console.warn('[magnet] process load:', err.message || err);
    cached = { by_url: {} };
    cachedPath = file;
    return cached;
  }
}

function saveProcess(doc) {
  const file = processFile();
  const next = { by_url: (doc && doc.by_url) || {} };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(next, { lineWidth: 100, noRefs: true, sortingKeys: false }), 'utf8');
  cached = next;
  cachedPath = file;
}

function emptyRecord() {
  return {
    status: 'open',
    submitted_at: null,
    rejected_at: null,
    contacts: [],
    events: [],
    prep_notes: '',
    jd: null,
    posting: null,
    essays: [],
  };
}

function getRecord(url) {
  return { ...emptyRecord(), ...persistApi().getProcess(url) };
}

function statusFrom(localStatus, agent) {
  const local = localStatus || 'open';
  if (local !== 'open') return local;
  return agent ? 'submitted' : local;
}

let supabaseStatusCache = { at: 0, map: null };

function invalidateSupabaseStatus() {
  supabaseStatusCache = { at: 0, map: null };
}

function supabaseStatus(url) {
  if (!supabaseStatusCache.map) {
    const map = new Map();
    try {
      for (const job of persistApi().listJobs()) {
        if (job && job.url) map.set(String(job.url), job.status || 'open');
      }
    } catch (err) {
      console.warn('[magnet] status:', (err && err.message) || err);
    }
    supabaseStatusCache = { at: Date.now(), map };
  }
  return supabaseStatusCache.map.get(String(url)) || 'open';
}

function noteStatus(url, status) {
  if (!supabaseStatusCache.map || !url) return;
  supabaseStatusCache.map.set(String(url), status || 'open');
}

function seedSupabaseStatus(jobs) {
  const map = new Map();
  for (const job of jobs || []) {
    if (job && job.url) map.set(String(job.url), job.status || 'open');
  }
  if (map.size) supabaseStatusCache = { at: Date.now(), map };
}

function statusOf(url) {
  if (require('./store/mode').isSupabase()) {
    try {
      return supabaseStatus(url);
    } catch (err) {
      console.warn('[magnet] status:', (err && err.message) || err);
      return 'open';
    }
  }
  const local = persistApi().getProcess(url).status || 'open';
  let agent = false;
  try {
    agent = isAgentJob(url);
  } catch {
    agent = false;
  }
  return statusFrom(local, agent);
}

function isOpen(url) {
  const s = statusOf(url);
  return !s || s === 'open';
}

function writeRecord(url, patch) {
  const rec = persistApi().writeProcess(url, patch);
  noteStatus(url, rec && rec.status);
  return rec;
}

function appendEvent(url, event) {
  const rec = persistApi().appendProcessEvent(url, event);
  noteStatus(url, rec && rec.status);
  return rec;
}

function seedFromLegacyFlags(byUrl) {
  const api = persistApi();
  let submitted = 0;
  for (const [url, flags] of Object.entries(byUrl || {})) {
    if (api.hasProcess(url)) {
      if (api.getProcess(url).status === 'submitted') submitted += 1;
      continue;
    }
    if (flags.submitted) {
      api.writeProcess(url, {
        ...emptyRecord(),
        status: 'submitted',
        submitted_at: flags.submitted_at || flags.updated_at || null,
        events: [
          {
            at: flags.submitted_at || new Date().toISOString(),
            type: 'submitted',
            title: 'Applied',
            body: '',
            contact_id: null,
            deleted: false,
          },
        ],
      });
      submitted += 1;
    } else if (flags.rejected) {
      api.writeProcess(url, {
        ...emptyRecord(),
        status: 'passed',
        events: [
          {
            at: flags.rejected_at || new Date().toISOString(),
            type: 'passed',
            title: 'Passed',
            body: '',
            contact_id: null,
            deleted: false,
          },
        ],
      });
    }
  }
  return submitted;
}

function filterBucket(status) {
  if (!status || status === 'open') return 'open';
  if (status === 'rejected') return 'rejected';
  if (status === 'passed') return 'passed';
  return 'submitted';
}

module.exports = {
  PROCESS_FILE,
  loadProcess,
  saveProcess,
  getRecord,
  statusFrom,
  seedSupabaseStatus,
  statusOf,
  isOpen,
  writeRecord,
  appendEvent,
  seedFromLegacyFlags,
  filterBucket,
  emptyRecord,
  invalidate,
  invalidateSupabaseStatus,
};
