const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, chainFor, DEFAULT_CHAIN, migrateCache, familyFromKey, isCacheableStrategy } = require('./strategy');

test('fingerprint is the widget family only', () => {
  const a = fingerprint({ fieldKind: 'text', widgetShape: 'text' });
  const b = fingerprint({ fieldKind: 'react_select', widgetShape: 'react_select' });
  assert.equal(a, 'text');
  assert.equal(b, 'react_select');
  assert.notEqual(a, b);
});

test('steps and run are not cacheable family pokes', () => {
  assert.equal(isCacheableStrategy('native_value'), true);
  assert.equal(isCacheableStrategy('input_events'), true);
  assert.equal(isCacheableStrategy('date_mask'), false);
  assert.equal(isCacheableStrategy('steps'), false);
  assert.equal(isCacheableStrategy('run'), false);
});

test('unknown family uses the default chain', () => {
  const fp = fingerprint({ fieldKind: 'not_a_real_family' });
  assert.deepEqual(chainFor(fp), DEFAULT_CHAIN);
});

test('familyFromKey folds v2 ats keys', () => {
  assert.equal(familyFromKey('v2|greenhouse|text'), 'text');
  assert.equal(familyFromKey('v2|unknown|native_select'), 'native_select');
  assert.equal(familyFromKey('text'), 'text');
});

test('migrateCache folds ats buckets into one family row', () => {
  const out = migrateCache({
    version: 2,
    fingerprints: {
      'v2|greenhouse|text': {
        strategies: { native_value: { wins: 33, losses: 0, last_verified_at: '2026-09-17T00:09:04.257Z' } },
        last_success: 'native_value',
        human_flags: [],
      },
      'v2|unknown|text': {
        strategies: { native_value: { wins: 5, losses: 4, last_verified_at: '2026-09-17T05:33:48.708Z' } },
        last_success: 'native_value',
        human_flags: ['filled_but_not_touched'],
      },
    },
  });
  assert.equal(out.version, 3);
  assert.equal(out.fingerprints.text.strategies.native_value.wins, 38);
  assert.equal(out.fingerprints.text.strategies.native_value.losses, 4);
  assert.equal(out.fingerprints.text.last_success, 'native_value');
  assert.deepEqual(out.fingerprints.text.human_flags, ['filled_but_not_touched']);
});

test('migrateCache drops date_mask as a family champion', () => {
  const out = migrateCache({
    version: 3,
    fingerprints: {
      text: {
        strategies: {
          native_value: { wins: 89, losses: 22 },
          date_mask: { wins: 160, losses: 0 },
        },
        last_success: 'date_mask',
        human_flags: [],
      },
    },
  });
  assert.equal(out.fingerprints.text.last_success, null);
  assert.equal(out.fingerprints.text.strategies.date_mask, undefined);
  assert.equal(out.fingerprints.text.strategies.native_value.wins, 89);
});

test('cacheSnapshot is a serializable copy of family stats', () => {
  const { cacheSnapshot } = require('./strategy');
  const snap = cacheSnapshot();
  assert.equal(typeof snap, 'object');
  if (snap.text) {
    assert.equal(typeof snap.text.last_success, 'string');
    assert.equal(typeof snap.text.strategies, 'object');
  }
});
