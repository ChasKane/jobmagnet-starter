const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

const MAIL_DIR = path.join(__dirname, '..', '..', 'knowledge', 'mail');
const INDEX_FILE = path.join(MAIL_DIR, 'index.yaml');
const SYNC_FILE = path.join(MAIL_DIR, 'sync.yaml');
const QUEUE_FILE = path.join(MAIL_DIR, 'queue.yaml');
const KEPT_DIR = path.join(MAIL_DIR, 'kept');
const SCRATCH_DIR = path.join(MAIL_DIR, 'scratch');
const OAUTH_FILE = path.join(MAIL_DIR, 'oauth.json');

const INTERVIEW_TYPES = new Set(['recruiter_screen', 'hiring_manager', 'panel', 'onsite']);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readYaml(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    return doc == null ? fallback : doc;
  } catch (err) {
    console.warn('[magnet] mail yaml:', file, err.message || err);
    return fallback;
  }
}

function writeYaml(file, doc) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100, noRefs: true, sortingKeys: false }), 'utf8');
}

function mailApi() {
  const persist = require('../../packages/persist');
  persist.open();
  return persist.nodeStore();
}

function loadIndex() {
  if (require('../store/mode').isSupabase()) {
    const index = {};
    for (const row of mailApi().listMailMessages()) {
      const copy = { ...row };
      delete copy.id;
      index[row.id] = copy;
    }
    return index;
  }
  const doc = readYaml(INDEX_FILE, {});
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
}

function saveIndex(index) {
  if (require('../store/mode').isSupabase()) {
    mailApi().replaceMailMessages(index || {});
    return;
  }
  writeYaml(INDEX_FILE, index || {});
}

function loadSync() {
  if (require('../store/mode').isSupabase()) return mailApi().getMailStatus();
  const doc = readYaml(SYNC_FILE, {});
  return doc && typeof doc === 'object' ? doc : {};
}

function saveSync(sync) {
  if (require('../store/mode').isSupabase()) {
    mailApi().setMailStatus(sync || {});
    return;
  }
  writeYaml(SYNC_FILE, sync || {});
}

function loadQueue() {
  if (require('../store/mode').isSupabase()) return mailApi().getMailQueue();
  const doc = readYaml(QUEUE_FILE, []);
  return Array.isArray(doc) ? doc : [];
}

function saveQueue(queue) {
  if (require('../store/mode').isSupabase()) {
    mailApi().replaceMailQueue(Array.isArray(queue) ? queue : []);
    return;
  }
  writeYaml(QUEUE_FILE, Array.isArray(queue) ? queue : []);
}

function hashText(text) {
  const norm = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(norm).digest('hex');
}

function findByHash(index, hash) {
  if (!hash) return null;
  for (const [id, row] of Object.entries(index || {})) {
    if (row && row.hash === hash) return { id, row };
  }
  return null;
}

function writeScratch(id, msg) {
  ensureDir(SCRATCH_DIR);
  fs.writeFileSync(path.join(SCRATCH_DIR, `${id}.json`), JSON.stringify(msg), 'utf8');
}

function clearScratch(id) {
  const p = path.join(SCRATCH_DIR, `${id}.json`);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
}

function writeKept(id, msg) {
  ensureDir(KEPT_DIR);
  fs.writeFileSync(path.join(KEPT_DIR, `${id}.json`), JSON.stringify(msg, null, 2), 'utf8');
}

function readKept(id) {
  const p = path.join(KEPT_DIR, `${id}.json`);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function hasKept(id) {
  return fs.existsSync(path.join(KEPT_DIR, `${id}.json`));
}

function listKept() {
  try {
    if (!fs.existsSync(KEPT_DIR)) return [];
    return fs
      .readdirSync(KEPT_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

function isInterviewTrack(rec) {
  if (!rec) return false;
  if (rec.status === 'interviewing' || rec.status === 'offer') return true;
  return (rec.events || []).some((e) => e && !e.deleted && INTERVIEW_TYPES.has(e.type));
}

function indexRow(msg, extra) {
  return {
    hash: extra.hash || hashText(msg.text),
    thread_id: msg.threadId || msg.thread_id || '',
    from: msg.from || '',
    subject: msg.subject || '',
    date: msg.date || '',
    verdict: extra.verdict || 'unsure',
    matched_url: extra.matched_url || null,
    keep_body: Boolean(extra.keep_body),
  };
}

module.exports = {
  MAIL_DIR,
  INDEX_FILE,
  SYNC_FILE,
  QUEUE_FILE,
  KEPT_DIR,
  SCRATCH_DIR,
  OAUTH_FILE,
  INTERVIEW_TYPES,
  loadIndex,
  saveIndex,
  loadSync,
  saveSync,
  loadQueue,
  saveQueue,
  hashText,
  findByHash,
  writeScratch,
  clearScratch,
  writeKept,
  readKept,
  hasKept,
  listKept,
  isInterviewTrack,
  indexRow,
};
