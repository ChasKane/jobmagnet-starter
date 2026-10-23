const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePrintView, inboxUrl, oauthCallbackParams, searchUrl } = require('./src/gmail-web');
const { b64urlDecode, decodeMessage, authUrl, LOOPBACK_REDIRECT } = require('./src/gmail-api');
const { mailShortcut } = require('./src/magnet-app');

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

test('oauthCallbackParams reads loopback and app scheme', () => {
  const loop = oauthCallbackParams('http://127.0.0.1:3871/mail/oauth/callback?code=abc');
  assert.equal(loop.code, 'abc');
  const app = oauthCallbackParams('jobmagnet://mail-oauth?code=xyz');
  assert.equal(app.code, 'xyz');
  assert.equal(oauthCallbackParams('https://mail.google.com/'), null);
});

test('b64urlDecode and authUrl', () => {
  assert.equal(b64urlDecode(Buffer.from('hi magnet').toString('base64url')), 'hi magnet');
  const url = authUrl({ clientId: 'cid.apps.googleusercontent.com', redirectUri: LOOPBACK_REDIRECT });
  assert.match(url, /accounts\.google\.com/);
  assert.match(url, /cid\.apps\.googleusercontent\.com/);
  assert.match(url, /gmail\.modify/);
});

test('decodeMessage reads a plain payload', () => {
  const msg = decodeMessage({
    id: 'm1',
    threadId: 't1',
    snippet: 'hello',
    internalDate: '1690000000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'jobs@contoso.com' },
        { name: 'Subject', value: 'Thanks' },
      ],
      body: { data: Buffer.from('We received your application.').toString('base64url') },
    },
  });
  assert.equal(msg.from, 'jobs@contoso.com');
  assert.match(msg.text, /received your application/);
});

test('mailShortcut detects connect and scan', () => {
  assert.equal(mailShortcut('connect gmail').needMailConnect, true);
  assert.equal(mailShortcut('scan inbox').needMailScan, true);
  assert.equal(mailShortcut('https://jobs.example.com/x'), null);
});

test('searchUrl encodes the Gmail query', () => {
  assert.match(searchUrl('foo bar'), /mail\.google\.com/);
  assert.match(searchUrl('foo bar'), /foo/);
});
