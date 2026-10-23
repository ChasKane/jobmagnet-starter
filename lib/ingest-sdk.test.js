const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `magnet-ingest-${process.pid}.sqlite`);
process.env.MAGNET_DB = dbFile;
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-ing-${process.pid}`);
process.env.MAGNET_HEURISTIC_COMPILE = '1';
process.env.MAGNET_PROFILE = path.join(os.tmpdir(), `magnet-profile-ing-${process.pid}.yaml`);
fs.writeFileSync(process.env.MAGNET_PROFILE, 'identity:\n  first_name: Alex\n');

const store = require('./store');
const graph = require('./graph');
const facts = require('./profile-facts');
const {
  ingestTools,
  buildPrompt,
  applicantUserText,
  withStoryReply,
  runIngestTurn,
} = require('./ingest-sdk');

function reset() {
  try {
    fs.unlinkSync(dbFile);
  } catch (_) {}
  store.close();
  store.open(dbFile);
  facts.invalidate();
}

test('ingest prompt tells Magnet to file work stories', () => {
  const prompt = buildPrompt({ message: 'find remote frontend' });
  assert.match(prompt, /save_story/);
  assert.match(prompt, /work-story/);
  assert.match(prompt, /Leave n unset/);
  assert.doesNotMatch(prompt, /Default n is/);
});

test('applicantUserText joins prior you-turns', () => {
  const text = applicantUserText({
    history: [
      { role: 'you', text: 'At Peloton I converted marketing pages to Page Builder.' },
      { role: 'magnet', text: 'Got it.' },
    ],
    message: 'find remote frontend',
  });
  assert.match(text, /Page Builder/);
  assert.match(text, /find remote frontend/);
});

test('save_story queues a confirm ask instead of filing', async () => {
  reset();
  const text = 'At Peloton I converted the bikes page to Page Builder. Did not own experiment outcomes.';
  const actions = {};
  const traces = [];
  const asks = [];
  const tools = ingestTools({ traces, asks, actions, userText: text });
  const out = await tools.save_story.execute({
    stories: [{ employer: 'Peloton', text }],
  });
  assert.match(out, /Keep/);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].kind, 'story-confirm');
  assert.equal(graph.cardIndex().length, 0);
});

test('resolving a story ask files the quoted card', async () => {
  reset();
  const { resolveStoryAsks, storyConfirmAsks } = require('./story-confirm');
  const text = 'At Peloton I converted the bikes page to Page Builder. Did not own experiment outcomes.';
  const asks = storyConfirmAsks([{ employer: 'Peloton', text }]);
  const out = await resolveStoryAsks(asks, { [asks[0].id]: { choice: 'Keep', employer: 'Peloton' } }, { userText: text });
  assert.equal(out.filed, 1);
  assert.equal(graph.cardIndex().length, 1);
});

test('save_story refuses unquoted invent', async () => {
  reset();
  const actions = {};
  const asks = [];
  const tools = ingestTools({
    traces: [],
    asks,
    actions,
    userText: 'find remote frontend 140k',
  });
  const out = await tools.save_story.execute({
    stories: [{ employer: 'Peloton', text: 'I owned experiment outcomes for Page Builder nationwide.' }],
  });
  assert.match(out, /Keep|Skip|Nothing to file/);
  assert.equal(graph.cardIndex().length, 0);
  assert.equal(graph.cardIndex({ minConfidence: 'extracted' }).length, 1);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].story.parked, true);
});

test('withStoryReply appends filed note once', () => {
  const traces = [{ name: 'save_story', result: 'Filed 1 work note.' }];
  assert.equal(withStoryReply('Plan ready.', traces), 'Plan ready.\n\nFiled 1 work note.');
  assert.equal(withStoryReply('Filed 1 work note. Hunt next.', traces), 'Filed 1 work note. Hunt next.');
});

test('runIngestTurn throws when already aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    runIngestTurn(
      { message: 'find remote frontend' },
      { promptText: async () => ({ result: 'nope' }), Agent: {}, extractText: (r) => r.result, signal: ac.signal }
    ),
    (err) => err && err.cancelled
  );
});
