const { test } = require('node:test');
const assert = require('node:assert/strict');
const pageFind = require('./page-find');

test('collectHits finds non-overlapping matches', () => {
  const hits = pageFind.collectHits(['banana bandana'], 'ana', 20);
  assert.deepEqual(
    hits.map((h) => [h.start, h.end]),
    [
      [1, 4],
      [11, 14],
    ]
  );
});

test('collectHits does not overlap when advancing by needle length', () => {
  const hits = pageFind.collectHits(['aaaa'], 'aa', 20);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.start), [0, 2]);
});

test('one-character searches cap so a huge page cannot walk forever', () => {
  assert.equal(pageFind.maxMatches('a'), pageFind.MAX_SHORT);
  assert.equal(pageFind.maxMatches('eng'), pageFind.MAX_LONG);
  const texts = [ 'x'.repeat(10) + 'a'.repeat(400) ];
  const hits = pageFind.collectHits(texts, 'a', pageFind.maxMatches('a'));
  assert.equal(hits.length, pageFind.MAX_SHORT);
});

test('script never calls native find or focuses nodes', () => {
  const src = pageFind.script('engineer', { findNext: false });
  assert.match(src, /CSS\.highlights/);
  assert.doesNotMatch(src, /findInPage|window\.find\(|\.focus\(/);
  assert.doesNotMatch(src, /position:\s*fixed/);
});
