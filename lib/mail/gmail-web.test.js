const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePrintView, inboxUrl } = require('./gmail-web');

test('parsePrintView pulls from/subject/body', () => {
  const html = `
    <b>From:</b> Acme &lt;no-reply@greenhouse-mail.io&gt;<br>
    <b>Subject:</b> Your application to Acme<br>
    <b>Date:</b> Thu, 4 Sep 2026 12:00:00 -0400<br>
    <p>We will not be moving forward with your application.</p>
  `;
  const msg = parsePrintView(html, 'thread-1');
  assert.equal(msg.id, 'thread-1');
  assert.match(msg.from, /Acme/);
  assert.match(msg.subject, /application to Acme/);
  assert.match(msg.text, /will not be moving forward/);
});

test('inboxUrl accepts Gmail, rejects sign-in', () => {
  assert.equal(inboxUrl('https://mail.google.com/mail/u/0/#inbox'), true);
  assert.equal(inboxUrl('https://accounts.google.com/ServiceLogin?continue=https://mail.google.com'), false);
});
