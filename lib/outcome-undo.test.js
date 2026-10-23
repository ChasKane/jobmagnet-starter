const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  HOLD_MS,
  snapshotRecord,
  revertRecord,
  countKind,
  eventTypeOf,
  toastPayload,
} = require('./outcome-undo');

test('snapshot keeps prior status timestamps', () => {
  const snap = snapshotRecord({
    status: 'submitted',
    submitted_at: '2026-01-01',
    rejected_at: null,
  });
  assert.deepEqual(snap, {
    status: 'submitted',
    submitted_at: '2026-01-01',
    rejected_at: null,
  });
});

test('revert marks the latest matching event deleted and restores snap', () => {
  const rec = {
    status: 'passed',
    submitted_at: null,
    rejected_at: null,
    events: [
      { type: 'note', title: 'x', deleted: false },
      { type: 'passed', title: 'Passed', deleted: false },
    ],
    essays: [{ label: 'Why' }],
  };
  const next = revertRecord(rec, 'passed', snapshotRecord({ status: 'open' }));
  assert.equal(next.status, 'open');
  assert.equal(next.events[0].deleted, false);
  assert.equal(next.events[1].deleted, true);
  assert.equal(next.essays[0].label, 'Why');
});

test('toast payload includes undo and a draining hold', () => {
  const out = toastPayload({ kind: 'complete', name: 'Acme', detail: 'saved 1 answer you wrote yourself' });
  assert.equal(out.undo, true);
  assert.equal(out.kind, 'complete');
  assert.equal(out.holdMs, HOLD_MS);
  assert.equal(out.message, 'Completed Acme · saved 1 answer you wrote yourself');
  assert.equal(countKind('complete'), 'submitted');
  assert.equal(eventTypeOf('pass'), 'passed');
});
