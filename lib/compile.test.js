const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `magnet-compile-${process.pid}.sqlite`);
process.env.MAGNET_DB = dbFile;
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-c-${process.pid}`);

const store = require('./store');
const graph = require('./graph');
process.env.MAGNET_HEURISTIC_COMPILE = '1';

const { compileUpdates, compileFinals, magnetWouldWrite, applicantQuoted, parkExtracted, confirmExtracted } = require('./compile');

function reset() {
  try {
    fs.unlinkSync(dbFile);
  } catch (_) {}
  store.close();
  store.open(dbFile);
}

test('Magnet-authored updates do not insert cards', async () => {
  reset();
  const userText = 'I want a shorter why-us.';
  const invented = [{ employer: 'Peloton', text: 'I owned experiment outcomes for Page Builder nationwide.' }];
  assert.equal(magnetWouldWrite(invented, userText).length, 1);
  const patches = await compileUpdates(invented, { userText, source: 'chat', heuristic: true });
  assert.equal(patches.length, 0);
  assert.equal(graph.cardIndex().length, 0);
});

test('quoted applicant chat compiles a card; duplicate is a merge', async () => {
  reset();
  const text = 'At Peloton I converted the bikes page to Page Builder. Did not own experiment outcomes.';
  const patches = await compileUpdates([{ employer: 'Peloton', text }], { userText: text, source: 'chat', heuristic: true });
  assert.equal(patches[0].kind, 'create');
  const again = await compileUpdates([{ employer: 'Peloton', text }], { userText: text, source: 'chat', heuristic: true });
  assert.equal(again[0].kind, 'merge');
  assert.equal(graph.cardIndex().length, 1);
});

test('tag filter keeps matching cards and falls back if none match', async () => {
  reset();
  await compileUpdates(
    [{ employer: 'Freelance', text: 'Shipped Lupe ops platform with SQL triggers for audit logging.' }],
    { userText: 'Shipped Lupe ops platform with SQL triggers for audit logging.', source: 'chat', heuristic: true }
  );
  await compileUpdates(
    [{ employer: 'Peloton', text: 'Converted marketing pages to Page Builder for experiments.' }],
    { userText: 'Converted marketing pages to Page Builder for experiments.', source: 'chat', heuristic: true }
  );
  const index = graph.indexForTags(['ops-platform']);
  assert.ok(index.some((c) => /Lupe|ops/i.test(c.claim + c.tags.join(','))));
  assert.ok(index.every((c) => c.tags.includes('ops-platform')));
  const fallback = graph.indexForTags(['not-a-real-tag']);
  assert.equal(fallback.length, graph.cardIndex().length);
});

test('magnet finals do not compile; applicant finals do', async () => {
  reset();
  await compileFinals([
    { origin: 'magnet', final: 'I led Page Builder across the whole org and owned all metrics.', company: 'Peloton', label: 'why' },
    {
      origin: 'applicant',
      final: 'I converted Peloton marketing pages to Page Builder. I did not own experiment readouts.',
      company: 'Peloton',
      label: 'why',
      ts: '2026-01-01',
    },
  ]);
  const cards = graph.cardIndex();
  assert.equal(cards.length, 1);
  assert.match(cards[0].honesty_bound || cards[0].claim, /not own|Page Builder|converted/i);
});

test('finals do not file the application company as an employer', async () => {
  reset();
  await compileFinals([
    {
      origin: 'applicant',
      company: 'Canonical',
      label: 'why',
      ts: '2026-01-02',
      final:
        'example.com/lupe and see the live demo. My client managed client-intake in a mess of spreadsheets so we built them an app for it with mandatory 2FA and audit-logging.',
    },
    {
      origin: 'applicant',
      company: 'Elicit',
      label: 'why us',
      ts: '2026-01-03',
      final:
        "I'm a rationalist and I want to work on forecasting because the research is interesting and the team seems kind.",
    },
  ]);
  const cards = graph.cardIndex();
  assert.equal(cards.length, 1);
  assert.ok(!/Canonical|Elicit/i.test(cards[0].employer || ''));
  const employers = graph.listTimeline().map((r) => r.employer);
  assert.ok(!employers.some((e) => /Canonical|Elicit/i.test(e)));
});

test('auto-filler prose compiles without naming JobMagnet', async () => {
  reset();
  await compileFinals([
    {
      origin: 'rewrite',
      company: 'Metabase',
      label: 'anything more',
      ts: '2026-09-12',
      final:
        "I've been building a job application form auto-filler that drafts essay answers from a content graph of my career stories which grows each time I enter something new. I also built a review panel that lets me query an LLM after each autofill run.",
    },
  ]);
  const cards = graph.cardIndex();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].employer || '', '');
  assert.ok(cards[0].tags.includes('jobmagnet'));
});

test('finals patch source cards instead of opening a new one', async () => {
  reset();
  const first = await compileUpdates(
    [
      {
        employer: 'Freelance',
        text: 'I built JobMagnet, an Electron apply browser that autofills ATS forms.',
      },
    ],
    { userText: 'I built JobMagnet, an Electron apply browser that autofills ATS forms.', source: 'chat', heuristic: true }
  );
  const id = first[0].card.id;
  await compileFinals([
    {
      origin: 'rewrite',
      source_card_ids: [id],
      ts: '2026-09-12',
      label: 'why',
      final:
        'I already do this with a job application form auto-filler and a review panel that inspects wrong HTML fill strategy and patches it.',
    },
  ]);
  const cards = graph.cardIndex();
  assert.equal(cards.length, 1);
  assert.match(cards[0].claim + cards[0].honesty_bound, /JobMagnet|apply browser|auto-filler/i);
});

test('applicantQuoted requires overlap', () => {
  assert.equal(applicantQuoted('hello there friend', 'hello there friend how are you'), true);
  assert.equal(applicantQuoted('secret invented fact about leadership', 'shorten the draft'), false);
});

test('parkExtracted writes extracted cards that default index hides', async () => {
  reset();
  const parked = await parkExtracted(
    [{ employer: 'Peloton', text: 'I owned experiment outcomes for Page Builder nationwide.' }],
    { userText: 'find remote frontend', source: 'chat', heuristic: true }
  );
  assert.equal(parked.length, 1);
  assert.equal(parked[0].parked, true);
  assert.ok(parked[0].card_id);
  assert.equal(graph.cardIndex().length, 0);
  assert.equal(graph.cardIndex({ minConfidence: 'extracted' }).length, 1);
  confirmExtracted(parked[0].card_id);
  assert.equal(graph.cardIndex().length, 1);
});
