const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packForSend, expandFold, nextAgentAction, estimateTokens } = require('./context-budget');

test('50% yeet drops oldest messages', () => {
  const old = { role: 'you', text: 'x'.repeat(1200) };
  const newer = { role: 'magnet', text: 'ok' };
  const packed = packForSend({
    snapshot: 'snap',
    messages: [old, newer],
    userLine: 'next',
    windowTokens: 400,
  });
  assert.equal(packed.yeeted, true);
  assert.ok(packed.dropped.length >= 1);
  assert.equal(packed.dropped[0], old);
  assert.ok(packed.tokens <= packed.budget);
});

test('expand restores newest-dropped first until the window is exhausted', () => {
  const folded = [
    { role: 'you', text: 'a'.repeat(80) },
    { role: 'magnet', text: 'b'.repeat(80) },
  ];
  const out = expandFold({
    kept: [{ role: 'you', text: 'now' }],
    folded,
    snapshot: '',
    userLine: '',
    windowTokens: 80,
  });
  assert.equal(out.expanded, true);
  assert.ok(out.kept.length >= 2);
});

test('model change keeps agentId; yeet/expand mint', () => {
  assert.deepEqual(nextAgentAction({ agentId: 'a1', modelChanged: true }), {
    mint: false,
    keepId: true,
    sendModel: true,
  });
  assert.equal(nextAgentAction({ agentId: 'a1', yeet: true }).keepId, false);
  assert.equal(nextAgentAction({ agentId: 'a1', expand: true }).mint, true);
  assert.equal(nextAgentAction({ agentId: '' }).mint, true);
});

test('token estimate is chars/4', () => {
  assert.equal(estimateTokens('abcd'), 1);
});
