const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTalkReply } = require('./talk-parse');

test('talk turns expose prose as reply', () => {
  const out = parseTalkReply('Inspect the query is the SQL inspector on that page.');
  assert.equal(out.reply, 'Inspect the query is the SQL inspector on that page.');
  assert.deepEqual(out.drafts, []);
  assert.deepEqual(out.profile_updates, []);
});

test('talk can trail a JSON object for updates', () => {
  const out = parseTalkReply('Got it, you are 30.\n{"profile_updates":[{"path":"identity.age","value":30}]}');
  assert.equal(out.reply, 'Got it, you are 30.');
  assert.equal(out.profile_updates[0].value, 30);
});

test('whole-blob cascade JSON still parses', () => {
  const out = parseTalkReply('{"reply":"Okay.","drafts":[{"id":"q1","text":"Draft"}]}');
  assert.equal(out.reply, 'Okay.');
  assert.equal(out.drafts[0].id, 'q1');
});

test('leaked JSON escapes become real newlines in drafts', () => {
  const { unescapeDraftText } = require('./talk-parse');
  assert.equal(unescapeDraftText('a\\n\\nb'), 'a\n\nb');
  assert.equal(unescapeDraftText('a\n\nb'), 'a\n\nb');
});
