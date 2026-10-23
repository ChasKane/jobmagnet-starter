const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build, longest, search } = require('./alias-index');
const { normalizeQuestion } = require('./normalize');

test('longest alias wins', () => {
  const auto = build([
    { needle: 'hear', payload: { id: 'short' } },
    { needle: 'hear about', payload: { id: 'hear_about' } },
  ]);
  const { hit, tie } = longest('how did you hear about hive', auto);
  assert.equal(tie, false);
  assert.equal(hit.payload.id, 'hear_about');
});

test('same-span different classes is a tie', () => {
  const auto = build([
    { needle: 'work from', payload: { id: 'a' } },
    { needle: 'work from', payload: { id: 'b' } },
  ]);
  const { hit, tie } = longest('where will you work from', auto);
  assert.equal(tie, true);
  assert.equal(hit, null);
});

test('normalized questions scan in one pass', () => {
  const auto = build([
    { needle: normalizeQuestion('how many years'), payload: { id: 'years' } },
    { needle: normalizeQuestion('cover letter'), payload: { id: 'essay' } },
  ]);
  const hits = search(normalizeQuestion('How many years of Vue experience?'), auto);
  assert.equal(hits.some((h) => h.payload.id === 'years'), true);
  assert.equal(hits.some((h) => h.payload.id === 'essay'), false);
});
