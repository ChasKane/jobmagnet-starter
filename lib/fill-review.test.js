const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReviewJson, runFillReview } = require('./fill-review');

test('parseReviewJson keeps fills and asks', () => {
  const parsed = parseReviewJson('note\n{"reply":"ok","fills":[{"id":"s","value":"UW"}],"asks":[]}');
  assert.equal(parsed.reply, 'ok');
  assert.equal(parsed.fills[0].value, 'UW');
});

test('parseReviewJson keeps allowlisted class_id', () => {
  const parsed = parseReviewJson(
    '{"reply":"","fills":[{"id":"o","value":"queer","class_id":"eeo:orientation"}]}'
  );
  assert.equal(parsed.fills[0].class_id, 'eeo:orientation');
});

test('runFillReview can reuse a sendChat session instead of promptText', async () => {
  const sent = [];
  const out = await runFillReview(
    { residuals: [{ id: 's', label: 'School' }], instruction: 'UW', focus_id: 's' },
    {
      sendChat: async (prompt) => {
        sent.push(prompt);
        return '{"reply":"Saved UW","fills":[{"id":"s","value":"UW"}],"asks":[]}';
      },
    }
  );
  assert.equal(sent.length, 1);
  assert.match(sent[0], /focus_id/);
  assert.equal(out.fills[0].value, 'UW');
  assert.equal(out.reply, 'Saved UW');
});
