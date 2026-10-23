const INGEST_KEY = '__ingest__';
const LABEL_MAX = 8;
const OVERFLOW_MAX = 8;
const SKIP_KEYS = new Set(['__mail__', '__hunt__']);
const PAGE_TABS_RIGHT = ['jd', 'debug', 'chat'];
const PAGE_TABS_LEFT = ['chat', 'debug', 'jd'];
const SKIP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'in', 'de', 'la', 'le', 'el']);

function asHandedness(value) {
  return String(value || '').toLowerCase() === 'left' ? 'left' : 'right';
}

function isIngest(key) {
  return String(key || '') === INGEST_KEY;
}

function isSkippedKey(key) {
  return SKIP_KEYS.has(String(key || ''));
}

function isJobKey(key) {
  const k = String(key || '').trim();
  if (!k || isIngest(k) || isSkippedKey(k)) return false;
  if (k.startsWith('__')) return false;
  return true;
}

function asPageSubtab(value) {
  const v = String(value || '').trim();
  if (v === 'jd' || v === 'debug' || v === 'chat') return v;
  if (v === 'review') return 'debug';
  return 'chat';
}

function pageTabs(handedness) {
  return asHandedness(handedness) === 'left' ? PAGE_TABS_LEFT.slice() : PAGE_TABS_RIGHT.slice();
}

function pageRailVisible(active) {
  return isJobKey(active);
}

function letters(word) {
  return String(word || '').replace(/[^a-zA-Z0-9]/g, '');
}

function chatTabLabel(name, opts = {}) {
  if (opts.ingest || isIngest(name)) return 'Ingest';
  const raw = String(name || '').trim();
  if (!raw) return 'Job';
  const words = raw.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length - 1) {
    const word = words[i];
    const core = letters(word);
    if (SKIP_WORDS.has(word.toLowerCase()) || core.length <= 2) i += 1;
    else break;
  }
  let label = letters(words[i]) || words[i];
  const next = words[i + 1];
  if (letters(label).length <= 3 && next) {
    const extra = letters(next) || next;
    label = label + extra;
  }
  if (label.length > LABEL_MAX) label = label.slice(0, LABEL_MAX);
  return label || 'Job';
}

function emptyUi() {
  return { mru: [], active: INGEST_KEY };
}

function normalizeUi(ui) {
  const src = ui && typeof ui === 'object' && !Array.isArray(ui) ? ui : {};
  const seen = new Set();
  const mru = [];
  for (const raw of Array.isArray(src.mru) ? src.mru : []) {
    const key = String(raw || '').trim();
    if (!isJobKey(key) || seen.has(key)) continue;
    seen.add(key);
    mru.push(key);
  }
  let active = String(src.active || INGEST_KEY).trim() || INGEST_KEY;
  if (isSkippedKey(active)) active = INGEST_KEY;
  if (isJobKey(active) && !seen.has(active)) mru.unshift(active);
  if (!isIngest(active) && !isJobKey(active)) active = INGEST_KEY;
  return { mru, active };
}

function ensureTab(ui, key) {
  const next = normalizeUi(ui);
  const k = String(key || '').trim();
  if (!isJobKey(k) || next.mru.includes(k)) return next;
  if (next.mru.length) next.mru.splice(1, 0, k);
  else next.mru.push(k);
  return next;
}

function bumpTab(ui, key) {
  const next = normalizeUi(ui);
  const k = String(key || '').trim();
  if (!k || isSkippedKey(k)) return next;
  next.active = isIngest(k) || isJobKey(k) ? k : next.active;
  if (!isJobKey(k)) return next;
  next.mru = [k, ...next.mru.filter((item) => item !== k)];
  return next;
}

function selectTab(ui, key) {
  return bumpTab(ui, key);
}

function jobFitFromWidth(width, jobCount) {
  const n = Math.max(0, Number(jobCount) || 0);
  const avail = Math.max(0, Number(width) || 0);
  const more = 40;
  const ingest = 58;
  const gap = 4;
  const pill = 64;
  let fit = Math.floor((avail - more - ingest - gap * 2) / (pill + gap));
  if (n > 0) fit = Math.max(1, fit);
  return Math.max(0, Math.min(n, fit));
}

function packSubtabs(opts = {}) {
  const ui = normalizeUi(opts);
  const keys = ui.mru.filter(isJobKey);
  const fit = Math.max(0, Math.floor(Number(opts.jobFit) || 0));
  const showN = keys.length ? Math.max(0, Math.min(fit || (keys.length ? 1 : 0), keys.length)) : 0;
  const visibleKeys = keys.slice(0, showN);
  const hidden = keys.slice(showN);
  const overflowMax = Math.max(1, Number(opts.overflowMax) || OVERFLOW_MAX);
  const overflow = hidden.slice(0, overflowMax);
  const ingest = { key: INGEST_KEY, kind: 'ingest', label: 'Ingest' };
  const jobs = visibleKeys.map((key) => ({ key, kind: 'job', label: opts.labels && opts.labels[key] ? opts.labels[key] : key }));
  const left = asHandedness(opts.handedness) === 'left';
  return {
    active: ui.active,
    moreSide: left ? 'right' : 'left',
    pills: left ? [ingest, ...jobs] : [...jobs.slice().reverse(), ingest],
    overflow,
    seeAll: hidden.length > overflowMax,
    pageRail: pageRailVisible(ui.active),
  };
}

module.exports = {
  INGEST_KEY,
  LABEL_MAX,
  OVERFLOW_MAX,
  SKIP_KEYS,
  PAGE_TABS_RIGHT,
  PAGE_TABS_LEFT,
  asHandedness,
  asPageSubtab,
  isIngest,
  isSkippedKey,
  isJobKey,
  pageTabs,
  pageRailVisible,
  chatTabLabel,
  emptyUi,
  normalizeUi,
  ensureTab,
  bumpTab,
  selectTab,
  jobFitFromWidth,
  packSubtabs,
};
