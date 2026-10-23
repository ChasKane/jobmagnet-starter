const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const STATE_FILE = path.join(__dirname, '..', 'knowledge', 'application-state.yaml');

function remoteTotals() {
  if (!require('./store/mode').isSupabase()) return null;
  const persist = require('../packages/persist');
  persist.open();
  return persist.nodeStore().getTotals();
}

function loadState() {
  const remote = remoteTotals();
  if (remote) return { totals: remote };
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { totals: { submitted: 0, passed: 0, rejected: 0 } };
    }
    const doc = yaml.load(fs.readFileSync(STATE_FILE, 'utf8')) || {};
    if (!doc.totals) doc.totals = { submitted: 0, passed: 0, rejected: 0 };
    doc.totals.submitted = Number(doc.totals.submitted || 0);
    doc.totals.passed = Number(doc.totals.passed || 0);
    doc.totals.rejected = Number(doc.totals.rejected || 0);
    return doc;
  } catch (err) {
    console.warn('[magnet] state load:', err.message || err);
    return { totals: { submitted: 0, passed: 0, rejected: 0 } };
  }
}

function saveState(doc) {
  fs.writeFileSync(
    STATE_FILE,
    yaml.dump(
      { totals: doc.totals || { submitted: 0, passed: 0, rejected: 0 } },
      { lineWidth: 100, noRefs: true, sortingKeys: false }
    ),
    'utf8'
  );
}

function bump(kind) {
  const remote = remoteTotals();
  if (remote) return remote;
  const doc = loadState();
  doc.totals[kind] = Number(doc.totals[kind] || 0) + 1;
  saveState(doc);
  return doc.totals;
}

function unbump(kind) {
  const remote = remoteTotals();
  if (remote) return remote;
  const doc = loadState();
  doc.totals[kind] = Math.max(0, Number(doc.totals[kind] || 0) - 1);
  saveState(doc);
  return doc.totals;
}

function seedSubmitted(count) {
  const doc = loadState();
  if (!doc.totals.submitted && count > 0) {
    doc.totals.submitted = count;
    saveState(doc);
  }
  return doc.totals;
}

module.exports = { STATE_FILE, loadState, saveState, bump, unbump, seedSubmitted };
