const { test } = require('node:test');
const assert = require('node:assert/strict');
const { heuristicIntent } = require('./intent-parse');
const { mailShortcut, runIngestChat } = require('./ingest-chat');

test('gmail connect phrases skip the LLM', () => {
  for (const msg of [
    'connect gmail',
    'connect my gmail',
    'how do i get you to see my gmail',
    'sign in to gmail',
  ]) {
    assert.equal(heuristicIntent(msg).action, 'connect_mail', msg);
  }
});

test('gmail scan phrases skip the LLM', () => {
  for (const msg of ['scan my mail', 'scan inbox', 'scan gmail']) {
    assert.equal(heuristicIntent(msg).action, 'scan_mail', msg);
  }
});

test('ingest chat opens OAuth without an SDK turn', async () => {
  const out = await runIngestChat('connect gmail');
  assert.equal(out.needConnect, true);
  assert.match(out.reply, /Opening Google sign-in/);
  assert.equal(mailShortcut('scan my mail').needScan, true);
});
