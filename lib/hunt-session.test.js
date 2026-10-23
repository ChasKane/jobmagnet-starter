const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  planKey,
  canResume,
  snapshotSession,
  restoreState,
  resumeHint,
  normalizeSession,
} = require('./hunt-session');

const schema = { n: 12, sites: ['linkedin', 'greenhouse'], titleIncludes: ['frontend'] };

test('same plan can resume while under n', () => {
  const session = snapshotSession(
    { added: ['https://jobs.example/a'], jobs: [{ url: 'https://jobs.example/a' }], have: new Set(['https://jobs.example/a']), dupes: 1, jds: 1, need: 12 },
    { schema, jsonDone: true, href: 'https://www.linkedin.com/jobs/search/', round: 2, last: 'still hunting' }
  );
  assert.equal(canResume(session, schema), true);
  assert.equal(canResume(session, { ...schema, n: 40 }), false);
  const hint = resumeHint(session, schema);
  assert.equal(hint.added, 1);
  assert.equal(hint.jsonDone, true);
  assert.equal(hint.round, 2);
});

test('finished hunt is not resumable', () => {
  const session = snapshotSession(
    { added: ['a', 'b'], have: new Set(['a', 'b']), jobs: [], dupes: 0, jds: 0, need: 2 },
    { schema: { n: 2, sites: ['linkedin'] }, status: 'done' }
  );
  assert.equal(canResume(session, { n: 2, sites: ['linkedin'] }), false);
});

test('restoreState rebuilds the in-run Set', () => {
  const session = normalizeSession({
    schema,
    added: ['https://jobs.example/a', 'https://jobs.example/a'],
    have: ['https://jobs.example/b'],
    jobs: [{ url: 'https://jobs.example/a', title: 'FE' }],
    need: 12,
    dupes: 3,
  });
  const state = restoreState(session);
  assert.equal(state.added.length, 1);
  assert.equal(state.have.has('https://jobs.example/a'), true);
  assert.equal(state.have.has('https://jobs.example/b'), true);
  assert.equal(state.dupes, 3);
  assert.equal(state.need, 12);
  assert.equal(state.jsonDone, false);
  assert.equal(state.resumed, false);
});

test('planKey is stable for the same search program', () => {
  assert.equal(planKey(schema), planKey({ ...schema, titleIncludes: ['frontend'] }));
  assert.notEqual(planKey(schema), planKey({ ...schema, keywords: ['react'] }));
});
