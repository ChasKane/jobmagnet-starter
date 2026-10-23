const { test } = require('node:test');
const assert = require('node:assert/strict');
const { authUrl, oauthReady, redirectUri, connected, loadTokens } = require('./oauth');

test('oauth is not ready without a client id', () => {
  const prevId = process.env.GMAIL_CLIENT_ID;
  const prevSecret = process.env.GMAIL_CLIENT_SECRET;
  process.env.GMAIL_CLIENT_ID = '';
  process.env.GMAIL_CLIENT_SECRET = '';
  try {
    assert.equal(oauthReady(), false);
    assert.equal(authUrl(), null);
    assert.match(redirectUri(), /^http:\/\/127\.0\.0\.1:\d+\/mail\/oauth\/callback$/);
  } finally {
    if (prevId) process.env.GMAIL_CLIENT_ID = prevId;
    else delete process.env.GMAIL_CLIENT_ID;
    if (prevSecret) process.env.GMAIL_CLIENT_SECRET = prevSecret;
    else delete process.env.GMAIL_CLIENT_SECRET;
  }
});

test('a wrapped refresh token is stored as one line', () => {
  const prev = process.env.GMAIL_REFRESH_TOKEN;
  process.env.GMAIL_REFRESH_TOKEN = '1//wrapped\n    token';
  try {
    assert.equal(loadTokens().refresh_token, '1//wrappedtoken');
  } finally {
    if (prev) process.env.GMAIL_REFRESH_TOKEN = prev;
    else delete process.env.GMAIL_REFRESH_TOKEN;
  }
});

test('a refresh token in the environment counts as connected', () => {
  const prev = process.env.GMAIL_REFRESH_TOKEN;
  process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
  try {
    assert.equal(connected(), true);
    assert.equal(loadTokens().refresh_token, 'test-refresh-token');
  } finally {
    if (prev) process.env.GMAIL_REFRESH_TOKEN = prev;
    else delete process.env.GMAIL_REFRESH_TOKEN;
  }
});
