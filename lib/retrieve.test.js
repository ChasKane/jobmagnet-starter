const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.MAGNET_DB = path.join(os.tmpdir(), `magnet-retrieve-${process.pid}.sqlite`);
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-retrieve-${process.pid}`);

const { wantsRetrieve, retrieveForDraft } = require('./retrieve');

test('use JM / incorporate runs retrieve', () => {
  assert.equal(
    wantsRetrieve('use jm for this, incorporate it into the part about wanting to work on X'),
    true
  );
  assert.equal(wantsRetrieve('Yes'), false);
  assert.equal(wantsRetrieve('https://metabase.com/about'), true);
});

test('retrieveForDraft is always on, even without reuse words', () => {
  const got = retrieveForDraft({
    instruction: 'how might I end this draft?',
    company: 'Prophet Security',
    title: 'Founding Engineer',
    fields: [{ id: 'q1', label: 'Why this role' }],
  });
  assert.equal(got.needed, true);
  assert.equal(got.shape, 'why-us');
});

test('retrieveForDraft card scan is corroborated-only', () => {
  const fs = require('fs');
  const store = require('./store');
  const graph = require('./graph');
  try {
    fs.unlinkSync(process.env.MAGNET_DB);
  } catch (_) {}
  store.close();
  store.open(process.env.MAGNET_DB);
  graph.upsertCard({
    employer: 'Peloton',
    claim: 'Invented extracted leadership claim.',
    proof: 'Nope.',
    confidence: 'extracted',
    source: 'chat',
  });
  graph.upsertCard({
    employer: 'Freelance',
    claim: 'Shipped an ops platform with audit log.',
    proof: 'Client intake.',
    confidence: 'corroborated',
    source: 'test',
  });
  const got = retrieveForDraft({
    instruction: 'draft the why',
    company: 'Acme',
    title: 'FE',
    fields: [{ id: 'q1', label: 'Why this role' }],
  });
  assert.ok(got.cards.every((c) => c.confidence === 'corroborated'));
  assert.ok(!got.cards.some((c) => /Invented extracted/i.test(c.claim)));
});
