const { test } = require('node:test');
const assert = require('node:assert/strict');
const { storyConfirmAsks, resolveStoryAsks } = require('./story-confirm');

test('storyConfirmAsks emit Keep / Skip cards', () => {
  const asks = storyConfirmAsks([{ employer: 'Lupe', text: 'Shipped the TDS ops platform with Tash.' }]);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].kind, 'story-confirm');
  assert.ok(asks[0].options.some((o) => o.label === 'Keep'));
  assert.ok(asks[0].options.some((o) => o.label === 'Skip'));
  assert.match(asks[0].prompt, /Lupe/);
});

test('resolveStoryAsks keep on a parked extract bumps confidence', async () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dbFile = path.join(os.tmpdir(), `magnet-story-park-${process.pid}.sqlite`);
  process.env.MAGNET_DB = dbFile;
  process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-story-${process.pid}`);
  process.env.MAGNET_HEURISTIC_COMPILE = '1';
  const store = require('./store');
  const graph = require('./graph');
  try {
    fs.unlinkSync(dbFile);
  } catch (_) {}
  store.close();
  store.open(dbFile);
  const created = graph.upsertCard({
    employer: 'Peloton',
    claim: 'I owned experiment outcomes for Page Builder nationwide.',
    proof: 'I owned experiment outcomes for Page Builder nationwide.',
    confidence: 'extracted',
    source: 'chat',
  });
  const asks = storyConfirmAsks([
    {
      employer: 'Peloton',
      text: 'I owned experiment outcomes for Page Builder nationwide.',
      parked: true,
      card_id: created.card.id,
    },
  ]);
  const out = await resolveStoryAsks(asks, { [asks[0].id]: 'Keep' }, { userText: 'find jobs' });
  assert.equal(out.filed, 1);
  assert.equal(graph.cardIndex().length, 1);
});

test('resolveStoryAsks skip files nothing', async () => {
  const asks = storyConfirmAsks([{ employer: 'Lupe', text: 'Shipped the TDS ops platform with Tash.' }]);
  const out = await resolveStoryAsks(asks, { [asks[0].id]: 'Skip' }, { userText: '' });
  assert.equal(out.handled, true);
  assert.equal(out.filed, 0);
  assert.match(out.reply, /Skipped/);
});
