const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextAutofillJob, hasAutofillRun, asQueueN } = require('./src/autofill-queue');

test('nextAutofillJob skips ran, nonempty, and closed rows', () => {
  const jobs = [
    { id: 'a', url: 'https://a.example/1', bucket: 'open' },
    { id: 'b', url: 'https://b.example/1', bucket: 'open' },
    { id: 'c', url: 'https://c.example/1', bucket: 'open' },
    { id: 'd', url: 'https://d.example/1', bucket: 'submitted' },
  ];
  const recs = {
    'https://a.example/1': { status: 'open', events: [{ type: 'autofill' }] },
    'https://b.example/1': { status: 'open', essays: [{ id: 'why' }] },
    'https://c.example/1': { status: 'open', events: [] },
    'https://d.example/1': { status: 'submitted', events: [] },
  };
  const next = nextAutofillJob(jobs, {
    afterId: 'a',
    getProcess: (url) => recs[url],
  });
  assert.equal(next.id, 'c');
  assert.equal(hasAutofillRun(recs['https://a.example/1']), true);
});

test('asQueueN clamps', () => {
  assert.equal(asQueueN(-3), 0);
  assert.equal(asQueueN('4'), 4);
  assert.equal(asQueueN(99), 50);
});
