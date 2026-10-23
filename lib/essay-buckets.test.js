const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  guessBucket,
  bucketsFromText,
  bucketsFromModel,
  shouldRouteWhyRole,
  buildWhyRolePrompt,
  buildClassifyPrompt,
} = require('./essay-buckets');

test('why-role labels are the why bucket and project questions are not', () => {
  assert.equal(guessBucket({ label: 'Why do you want this role?' }), 'why-role');
  assert.equal(guessBucket({ label: 'What is it about Gamma or this specific role that made you apply?' }), 'why-role');
  assert.equal(guessBucket({ label: 'Why are you interested in working at Factory?' }), 'why-role');
  assert.equal(guessBucket({ label: 'What interests you most about this role?' }), 'why-role');
  assert.equal(guessBucket({ label: 'How has AI changed the way you build?' }), 'standard');
  assert.equal(guessBucket({ label: 'Tell us about a time you solved a hard problem' }), 'standard');
});

test('one classify payload covers every question and a bad payload falls back', () => {
  const fields = [
    { id: 'why', label: 'Why us?' },
    { id: 'proud', label: 'What are you proud of?' },
  ];
  const prompt = buildClassifyPrompt(fields);
  assert.match(prompt, /why-role/);
  assert.match(prompt, /"id":"why"/);
  assert.match(prompt, /"id":"proud"/);
  const parsed = bucketsFromText(
    '{"buckets":[{"id":"why","bucket":"why-role"},{"id":"proud","bucket":"standard"}]}',
    fields
  );
  assert.equal(parsed.get('why'), 'why-role');
  assert.equal(parsed.get('proud'), 'standard');
  const fallback = bucketsFromModel({ drafts: [{ id: 'why', text: 'nope' }], reply: '' }, fields);
  assert.equal(fallback.get('why'), 'why-role');
  assert.equal(fallback.get('proud'), 'standard');
});

test('why-role prompt is the pipe and not the four stages', () => {
  const prompt = buildWhyRolePrompt({
    company: 'Gamma',
    title: 'Frontend',
    jd: 'Collaborative documents.',
    fields: [{ id: 'why', label: 'Why Gamma?' }],
    cards: 'Peloton Page Builder',
    voice: 'Be short.',
  });
  assert.match(prompt, /Omg because y'all are building the coolest solution in the industry/);
  assert.match(prompt, /skip this section/);
  assert.match(prompt, /closest to this JD/);
  assert.match(prompt, /Peloton Page Builder/);
  assert.doesNotMatch(prompt, /## Stage 1 Strategy/);
  assert.doesNotMatch(prompt, /## Stage 4 Review/);
});

test('advice stays on the normal turn and a draft request uses the pipe', () => {
  assert.equal(shouldRouteWhyRole(''), true);
  assert.equal(shouldRouteWhyRole('how might I end this draft?'), false);
  assert.equal(shouldRouteWhyRole('draft this'), true);
});
