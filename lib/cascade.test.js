const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.MAGNET_DB = path.join(os.tmpdir(), `magnet-cascade-${process.pid}.sqlite`);
process.env.MAGNET_ARCHIVE = path.join(os.tmpdir(), `magnet-archive-cascade-${process.pid}`);

const fs = require('fs');
const store = require('./store');
const graph = require('./graph');
const {
  inferShape,
  buildTurnPrompt,
  draftUsesOnlyCards,
  parseJsonBlob,
  draftToolOpts,
  runCascade,
  indexWithBindings,
  loadTurnBodies,
} = require('./cascade');

const KEEP_CARD = {
  id: 'card_keep',
  employer: 'Peloton',
  claim: 'Page Builder conversion',
  proof: 'Converted bikes page.',
  honesty_bound: 'No traffic numbers.',
};
const OTHER_CARD = {
  id: 'card_other',
  employer: 'Airbnb',
  claim: 'Host tools',
  proof: 'Shipped calendar sync.',
  honesty_bound: '',
};
const JM_CARD = {
  id: 'card_jm',
  employer: 'Freelance',
  claim: 'I built JobMagnet for my own search.',
  proof: 'JobMagnet drafts ATS answers from a local graph.',
  honesty_bound: 'Not launched.',
  tags: ['electron'],
};

const PROPHET_CURRENT = `I'd put my portfolio here but then you'd have to actually look at it.
https://example.com

(the rest is a joke until I decide how to land it)`;

test('strategy JSON arrays merge instead of falling through as prose', () => {
  const obj = parseJsonBlob(
    '[{"shape":"general","strategy":"One number for JS."},{"shape":"general","strategy":"Zero for Svelte."}]'
  );
  assert.match(obj.strategy, /One number for JS/);
  assert.match(obj.strategy, /Zero for Svelte/);
});

test('turn prompt has all four stages, full current, and every passed-in card', () => {
  const prompt = buildTurnPrompt({
    company: 'Acme',
    title: 'FE',
    instruction: 'draft why us',
    voice: 'Be short.',
    bodies: [KEEP_CARD, OTHER_CARD],
    fields: [{ id: 'q1', label: 'Why this role', current: PROPHET_CURRENT }],
    jd: { text: 'Build frontend tools' },
  });
  assert.match(prompt, /## Stage 1 Strategy/);
  assert.match(prompt, /## Stage 2 Select/);
  assert.match(prompt, /## Stage 3 Draft/);
  assert.match(prompt, /## Stage 4 Review/);
  assert.match(prompt, /card_keep/);
  assert.match(prompt, /card_other/);
  assert.ok(draftUsesOnlyCards(prompt, ['card_keep', 'card_other']));
  assert.match(prompt, /example\.com/);
  assert.match(prompt, /you'd have to actually look at it/);
  assert.doesNotMatch(prompt, /Work experience on file \(complete/);
  assert.match(prompt, /Never write JobMagnet/);
  assert.match(prompt, /Return JSON only after Stage 4/);
  assert.doesNotMatch(prompt, /Mode: discuss/);
});

test('turn prompt glosses JobMagnet instead of name-dropping', () => {
  const prompt = buildTurnPrompt({
    company: 'Acme',
    title: 'FE',
    fields: [{ id: 'q1', label: 'Why', current: '' }],
    jd: { text: 'Ask' },
    voice: 'Be short.',
    bodies: [JM_CARD],
  });
  assert.match(prompt, /card_jm/);
  assert.doesNotMatch(prompt, /I built JobMagnet for my own search/);
  assert.match(prompt, /auto-filler|content graph/i);
});

test('inferShape maps proud-project', () => {
  assert.equal(inferShape([{ label: 'What project are you most proud of?' }], ''), 'proud-project');
  assert.equal(inferShape([{ label: 'Why do you want this role?' }], ''), 'why-us');
});

test('one send always gets webSearch, webFetch, and mcp', () => {
  assert.deepEqual(draftToolOpts({ instruction: '' }).tools, ['webSearch', 'webFetch', 'mcp']);
  assert.deepEqual(draftToolOpts({ instruction: 'how should I talk to them' }).tools, [
    'webSearch',
    'webFetch',
    'mcp',
  ]);
});

test('how might I end this draft forbids replacing current', () => {
  const prompt = buildTurnPrompt({
    company: 'Prophet Security',
    title: 'Founding Engineer',
    instruction: 'how might I end this draft?',
    voice: 'Be short.',
    bodies: [KEEP_CARD],
    fields: [{ id: 'q1', label: 'Why Prophet', current: PROPHET_CURRENT, maxLength: 2000 }],
    jd: { text: 'Build security products' },
  });
  assert.match(prompt, /how might I end this draft\?/);
  assert.match(prompt, /example\.com/);
  assert.match(prompt, /do not replace their joke, links, or lead/i);
  assert.match(prompt, /leave drafts empty/i);
  assert.match(prompt, /Never write internal card ids/i);
  assert.doesNotMatch(prompt, /Cite those ids in reply/i);
});

test('runCascade calls the model once and does not overwrite drafts', async () => {
  let calls = 0;
  const out = await runCascade(
    {
      company: 'Prophet Security',
      title: 'Founding Engineer',
      instruction: 'how might I end this draft?',
      voice: 'Be short.',
      bodies: [KEEP_CARD],
      fields: [{ id: 'q1', label: 'Why Prophet', current: PROPHET_CURRENT }],
      jd: { text: 'Build security products' },
    },
    {
      Agent: {},
      promptText: async () => {
        calls += 1;
        return {
          result: JSON.stringify({
            reply: 'Keep the joke and the portfolio link. End with one concrete overlap.',
            drafts: [],
          }),
        };
      },
      extractText: (r) => r.result,
      requestId: 'test-one-call',
    }
  );
  assert.equal(calls, 1);
  assert.deepEqual(out.parsed.drafts, []);
  assert.match(out.parsed.reply, /Keep the joke/);
  assert.match(out.prompt, /## Stage 1 Strategy/);
});

test('stage 4 includes applicant rubric when passed', () => {
  const prompt = buildTurnPrompt({
    company: 'Prophet Security',
    title: 'Founding Engineer',
    instruction: 'draft why us',
    voice: 'Be short.',
    bodies: [KEEP_CARD],
    fields: [{ id: 'q1', label: 'Why this role' }],
    jd: { text: 'Build tools' },
    rubric: { rubric: 'I already do this with a job-application auto-filler. Short, uneven.' },
  });
  assert.match(prompt, /## Stage 4 Review/);
  assert.match(prompt, /Applicant rewrite of this shape/);
  assert.match(prompt, /job-application auto-filler/);
  assert.match(prompt, /bounce and match this version/);
});

test('retrieved context is in the one turn prompt', () => {
  const prompt = buildTurnPrompt({
    instruction: 'use jm for this, incorporate it into the part about wanting to work on X',
    retrieved: 'Retrieved prior essays:\n(Acme) Why: I want to work on X.',
    company: 'Acme',
    title: 'FE',
    voice: 'Be short.',
    bodies: [],
    fields: [{ id: 'q1', label: 'Why this role' }],
    jd: { text: 'Build tools' },
  });
  assert.match(prompt, /Retrieved context/);
  assert.match(prompt, /I want to work on X/);
});

test('turn prompt honors bindings when provided', () => {
  const prompt = buildTurnPrompt({
    company: 'Acme',
    title: 'FE',
    fields: [{ id: 'q1', label: 'Why this role' }],
    jd: { text: 'Build ops tools' },
    voice: 'Be short.',
    bindings: [{ question_shape: 'why-us', tag: 'ops-platform' }],
    bodies: [{ id: 'card_x', tags: ['ops-platform'], employer: 'Freelance', claim: 'Ops platform' }],
  });
  assert.match(prompt, /Honor bindings/);
  assert.match(prompt, /ops-platform/);
});

test('turn prompt has no Honor bindings by default', () => {
  const prompt = buildTurnPrompt({
    company: 'Acme',
    title: 'FE',
    fields: [{ id: 'q1', label: 'Why this role' }],
    jd: { text: 'Build frontend tools' },
    voice: 'Be short.',
    bindings: [],
    bodies: [KEEP_CARD],
  });
  assert.doesNotMatch(prompt, /Honor bindings/);
});

test('indexWithBindings keeps matching cards and falls back when none match', () => {
  const index = [
    { id: 'card_ops', tags: ['ops-platform'] },
    { id: 'card_fe', tags: ['react'] },
  ];
  const filtered = indexWithBindings(index, [{ tag: 'ops-platform' }]);
  assert.deepEqual(
    filtered.map((c) => c.id),
    ['card_ops']
  );
  const fallback = indexWithBindings(index, [{ tag: 'no-such-tag' }]);
  assert.equal(fallback.length, 2);
  assert.equal(indexWithBindings(index, []).length, 2);
});

test('loadTurnBodies sends bindings plus retrieve ids, not every card', () => {
  const dbFile = process.env.MAGNET_DB;
  try {
    fs.unlinkSync(dbFile);
  } catch (_) {}
  store.close();
  store.open(dbFile);
  graph.upsertCard({
    employer: 'Freelance',
    claim: 'Shipped an ops platform with audit log.',
    proof: 'Client intake, 2FA, audit log.',
    tags: ['ops-platform'],
    confidence: 'corroborated',
    source: 'test',
  });
  graph.upsertCard({
    employer: 'Peloton',
    claim: 'Converted marketing pages.',
    proof: 'Page Builder.',
    tags: ['frontend'],
    confidence: 'corroborated',
    source: 'test',
  });
  graph.addBinding({ question_shape: 'why-us', tag: 'ops-platform', source: 'debrief' });
  const bodies = loadTurnBodies({ fields: [{ label: 'Why do you want this role?' }] });
  assert.equal(bodies.length, 1);
  assert.match(bodies[0].claim, /ops platform/i);
});
