const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewMessage, createMailPort } = require('./port');

test('MailPort classifies a received application without requiring Gmail', () => {
  const port = createMailPort();
  const out = port.review(
    {
      from: 'jobs@contoso.com',
      subject: 'Thanks for applying',
      text: 'We received your application to Contoso.',
    },
    [{ url: 'https://jobs.contoso.com/x', company: 'Contoso', title: 'Eng', status: 'submitted' }]
  );
  assert.ok(out.verdict);
  assert.ok(out.decision);
  assert.notEqual(out.verdict.verdict, 'reject');
});

test('reviewMessage is exported for mobile import', () => {
  assert.equal(typeof reviewMessage, 'function');
});
