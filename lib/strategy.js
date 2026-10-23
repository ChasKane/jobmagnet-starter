const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const FILE = path.join(__dirname, '..', 'knowledge', 'strategy-cache.yaml');
const CACHE_VERSION = 3;

const DEFAULT_CHAIN = [
  'native_value',
  'input_events',
  'select_value',
  'select_text',
  'label_click',
  'react_select',
  'combobox',
];

function fingerprint({ fieldKind, widgetShape } = {}) {
  return String(fieldKind || widgetShape || '');
}

function emptyRow() {
  return { strategies: {}, last_success: null, human_flags: [] };
}

function cloneRow(row) {
  const next = emptyRow();
  if (!row || typeof row !== 'object') return next;
  next.last_success = row.last_success || null;
  next.human_flags = Array.isArray(row.human_flags) ? row.human_flags.slice() : [];
  for (const [name, stats] of Object.entries(row.strategies || {})) {
    next.strategies[name] = {
      wins: Number(stats && stats.wins) || 0,
      losses: Number(stats && stats.losses) || 0,
      last_verified_at: (stats && stats.last_verified_at) || undefined,
    };
  }
  return next;
}

function familyFromKey(key) {
  const s = String(key || '');
  const old = s.match(/^v2\|[^|]+\|(.+)$/);
  if (old) return old[1];
  if (s.startsWith('v2|') && s.split('|').length === 2) return s.slice(3);
  return s;
}

function strategyWins(row, name) {
  return (row && row.strategies && row.strategies[name] && row.strategies[name].wins) || 0;
}

function mergeRows(a, b) {
  if (!a) return cloneRow(b);
  if (!b) return cloneRow(a);
  const next = emptyRow();
  const names = new Set([...Object.keys(a.strategies || {}), ...Object.keys(b.strategies || {})]);
  for (const name of names) {
    const left = (a.strategies && a.strategies[name]) || {};
    const right = (b.strategies && b.strategies[name]) || {};
    const lastA = left.last_verified_at || '';
    const lastB = right.last_verified_at || '';
    next.strategies[name] = {
      wins: (Number(left.wins) || 0) + (Number(right.wins) || 0),
      losses: (Number(left.losses) || 0) + (Number(right.losses) || 0),
      last_verified_at: lastA >= lastB ? left.last_verified_at || right.last_verified_at : right.last_verified_at || left.last_verified_at,
    };
  }
  next.human_flags = [...new Set([...(a.human_flags || []), ...(b.human_flags || [])])];
  const aName = a.last_success;
  const bName = b.last_success;
  if (aName && bName && aName !== bName) {
    next.last_success = strategyWins(a, aName) >= strategyWins(b, bName) ? aName : bName;
  } else {
    next.last_success = aName || bName || null;
  }
  return next;
}

function migrateCache(doc) {
  const fps = doc && doc.fingerprints && typeof doc.fingerprints === 'object' ? doc.fingerprints : {};
  const next = {};
  for (const [key, row] of Object.entries(fps)) {
    const family = familyFromKey(key);
    if (!family) continue;
    next[family] = mergeRows(next[family], row);
  }
  for (const row of Object.values(next)) {
    if (row.strategies && row.strategies.date_mask) delete row.strategies.date_mask;
    if (row.last_success === 'date_mask') row.last_success = null;
  }
  return { version: CACHE_VERSION, fingerprints: next };
}

let strategyDoc = null;
let strategyFlight = null;
let onStrategy = null;
let strategyDirty = false;
let strategyTimer = null;

function emptyStrategy() {
  return { version: CACHE_VERSION, fingerprints: {} };
}

function refreshStrategy() {
  if (strategyFlight) return strategyFlight;
  const persist = require('../packages/persist');
  persist.open();
  const api = persist.nodeStore();
  const run = typeof api.loadStrategyAsync === 'function' ? api.loadStrategyAsync() : Promise.resolve(api.loadStrategy());
  strategyFlight = Promise.resolve(run)
    .then((raw) => {
      strategyDoc = migrateCache(raw);
      strategyFlight = null;
      if (onStrategy) onStrategy();
      return strategyDoc;
    })
    .catch((err) => {
      strategyFlight = null;
      if (!strategyDoc) strategyDoc = emptyStrategy();
      console.warn('[magnet] strategy:', (err && err.message) || err);
      return strategyDoc;
    });
  return strategyFlight;
}

function scheduleStrategySave() {
  strategyDirty = true;
  clearTimeout(strategyTimer);
  strategyTimer = setTimeout(() => {
    strategyTimer = null;
    const doc = strategyDoc;
    if (!doc) return;
    strategyDirty = false;
    const persist = require('../packages/persist');
    persist.open();
    const api = persist.nodeStore();
    const run = typeof api.saveStrategyAsync === 'function' ? api.saveStrategyAsync(doc) : Promise.resolve(api.saveStrategy(doc));
    Promise.resolve(run).catch((err) => {
      strategyDirty = true;
      console.warn('[magnet] strategy save:', (err && err.message) || err);
    });
  }, 400);
}

function flushStrategy() {
  clearTimeout(strategyTimer);
  strategyTimer = null;
  if (!strategyDirty || !strategyDoc) return;
  if (!require('./store/mode').isSupabase()) return;
  strategyDirty = false;
  const persist = require('../packages/persist');
  persist.open();
  persist.nodeStore().saveStrategy(strategyDoc);
}

function loadCache() {
  if (require('./store/mode').isSupabase()) {
    if (!strategyDoc && !strategyFlight) refreshStrategy();
    return strategyDoc || emptyStrategy();
  }
  try {
    const doc = yaml.load(fs.readFileSync(FILE, 'utf8')) || {};
    return migrateCache(doc);
  } catch {
    return emptyStrategy();
  }
}

function liveStrategy() {
  if (!require('./store/mode').isSupabase()) return loadCache();
  return strategyDoc;
}

function saveCache(doc) {
  if (require('./store/mode').isSupabase()) {
    strategyDoc = migrateCache(doc || emptyStrategy());
    scheduleStrategySave();
    return;
  }
  fs.writeFileSync(
    FILE,
    yaml.dump(
      { version: CACHE_VERSION, fingerprints: doc.fingerprints || {} },
      { lineWidth: 120, noRefs: true, sortingKeys: false }
    ),
    'utf8'
  );
}

function isCacheableStrategy(name) {
  return DEFAULT_CHAIN.includes(String(name || ''));
}

function chainFor(fp) {
  const doc = loadCache();
  const row = doc.fingerprints[fp];
  const last =
    row && row.last_success !== 'date_mask' && isCacheableStrategy(row.last_success) ? row.last_success : null;
  if (!last) return DEFAULT_CHAIN.slice();
  const rest = DEFAULT_CHAIN.filter((s) => s !== last);
  const demoted = new Set((row.human_flags || []).filter((f) => DEFAULT_CHAIN.includes(f)));
  const ordered = [last, ...rest].filter((s) => !demoted.has(s));
  return ordered.length ? ordered : DEFAULT_CHAIN.slice();
}

function recordWin(fp, strategy) {
  if (!isCacheableStrategy(strategy)) return;
  const doc = liveStrategy();
  if (!doc) return;
  if (!doc.fingerprints[fp]) {
    doc.fingerprints[fp] = emptyRow();
  }
  const row = doc.fingerprints[fp];
  if (!row.strategies[strategy]) row.strategies[strategy] = { wins: 0, losses: 0 };
  row.strategies[strategy].wins += 1;
  row.strategies[strategy].last_verified_at = new Date().toISOString();
  row.last_success = strategy;
  saveCache(doc);
}

function recordLoss(fp, strategy) {
  const doc = liveStrategy();
  if (!doc) return;
  if (!isCacheableStrategy(strategy)) {
    if (doc.fingerprints[fp] && doc.fingerprints[fp].last_success === strategy) {
      doc.fingerprints[fp].last_success = null;
      saveCache(doc);
    }
    return;
  }
  if (!doc.fingerprints[fp]) {
    doc.fingerprints[fp] = emptyRow();
  }
  const row = doc.fingerprints[fp];
  if (!row.strategies[strategy]) row.strategies[strategy] = { wins: 0, losses: 0 };
  row.strategies[strategy].losses += 1;
  if (row.last_success === strategy) row.last_success = null;
  saveCache(doc);
}

function flag(fp, name) {
  const doc = liveStrategy();
  if (!doc) return;
  if (!doc.fingerprints[fp]) {
    doc.fingerprints[fp] = emptyRow();
  }
  const flags = new Set(doc.fingerprints[fp].human_flags || []);
  flags.add(name);
  doc.fingerprints[fp].human_flags = [...flags];
  if (name === 'filled_but_not_touched' && doc.fingerprints[fp].last_success) {
    const bad = doc.fingerprints[fp].last_success;
    recordLoss(fp, bad);
  }
  saveCache(doc);
}

function cacheSnapshot() {
  const doc = loadCache();
  const out = {};
  for (const [fp, row] of Object.entries(doc.fingerprints || {})) {
    out[fp] = {
      last_success: row.last_success || null,
      human_flags: Array.isArray(row.human_flags) ? row.human_flags.slice() : [],
      strategies: {},
    };
    for (const [name, stats] of Object.entries(row.strategies || {})) {
      out[fp].strategies[name] = {
        wins: Number(stats && stats.wins) || 0,
        losses: Number(stats && stats.losses) || 0,
        last_verified_at: (stats && stats.last_verified_at) || undefined,
      };
    }
  }
  return out;
}

function watchStrategy(fn) {
  onStrategy = fn;
}

module.exports = {
  DEFAULT_CHAIN,
  CACHE_VERSION,
  fingerprint,
  chainFor,
  recordWin,
  recordLoss,
  flag,
  isCacheableStrategy,
  migrateCache,
  familyFromKey,
  cacheSnapshot,
  watchStrategy,
  refreshStrategy,
  flushStrategy,
};
