const fs = require('fs');
const path = require('path');
const { OAUTH_FILE } = require('./cache');

const SCOPE = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GMAIL_LOGIN =
  'https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent('https://mail.google.com/mail/');

function loadDotEnv() {
  const p = path.join(__dirname, '..', '..', '.env');
  try {
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (_) {}
}

function redirectUri() {
  const port = Number(process.env.MAGNET_PORT || 3871);
  return `http://127.0.0.1:${port}/mail/oauth/callback`;
}

function credentials() {
  loadDotEnv();
  const clientId = process.env.GMAIL_CLIENT_ID || '';
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || '';
  return { clientId, clientSecret };
}

function oauthReady() {
  return Boolean(credentials().clientId);
}

function tokensFromEnv() {
  loadDotEnv();
  const refresh = String(process.env.GMAIL_REFRESH_TOKEN || '').replace(/\s+/g, '');
  const access = String(process.env.GMAIL_ACCESS_TOKEN || '').replace(/\s+/g, '');
  if (!refresh && !access) return null;
  const expiry = Number(process.env.GMAIL_TOKEN_EXPIRY || 0);
  return {
    refresh_token: refresh,
    access_token: access,
    expiry: Number.isFinite(expiry) ? expiry : 0,
    email: String(process.env.GMAIL_EMAIL || '').trim(),
    token_type: 'Bearer',
    scope: String(process.env.GMAIL_SCOPE || '').trim(),
  };
}

function scopeAllowsModify(scope) {
  return /auth\/gmail\.modify|https:\/\/mail\.google\.com\//.test(String(scope || ''));
}

function canModifyMail() {
  const t = loadTokens();
  if (!t) return false;
  if (t.modify === false) return false;
  const scope = String(t.scope || '');
  if (!scope) return false;
  return scopeAllowsModify(scope);
}

function needsModifyConsent() {
  const t = loadTokens();
  if (!t || !(t.refresh_token || t.access_token)) return false;
  if (t.modify === false) return true;
  const scope = String(t.scope || '');
  if (!scope) return true;
  return !scopeAllowsModify(scope);
}

async function rememberGrantedScope(access) {
  if (!access) return '';
  try {
    const res = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(access)}`);
    const json = await res.json().catch(() => ({}));
    const scope = String((json && json.scope) || '');
    if (!scope) return '';
    saveTokens({ scope, modify: scopeAllowsModify(scope) });
    return scope;
  } catch {
    return '';
  }
}

function loadTokens() {
  let file = null;
  try {
    if (fs.existsSync(OAUTH_FILE)) file = JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf8'));
  } catch {
    file = null;
  }
  const env = tokensFromEnv();
  if (!file && !env) return null;
  return { ...(env || {}), ...(file || {}) };
}

function saveTokens(tokens) {
  fs.mkdirSync(path.dirname(OAUTH_FILE), { recursive: true });
  const prev = loadTokens() || {};
  fs.writeFileSync(OAUTH_FILE, JSON.stringify({ ...prev, ...tokens }, null, 2), 'utf8');
}

function signedInEmail() {
  const t = loadTokens();
  return (t && t.email) || '';
}

function connected() {
  const t = loadTokens();
  if (!t) return false;
  if (t.refresh_token || t.access_token) return true;
  return Boolean(t.web && t.email);
}

function signOut() {
  try {
    if (fs.existsSync(OAUTH_FILE)) fs.unlinkSync(OAUTH_FILE);
  } catch (_) {}
}

function authUrl(opts) {
  const { clientId } = credentials();
  if (!clientId) return null;
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('include_granted_scopes', 'true');
  const email = (opts && opts.email) || signedInEmail();
  if (email) u.searchParams.set('login_hint', email);
  if (opts && opts.forceConsent) u.searchParams.set('prompt', 'consent');
  else if (!loadTokens() || !loadTokens().refresh_token) u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

async function fetchEmail(access) {
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access}` } });
    const json = await res.json();
    return json.email || '';
  } catch {
    return '';
  }
}

async function exchangeCode(code) {
  const { clientId, clientSecret } = credentials();
  const body = new URLSearchParams({
    code: String(code || ''),
    client_id: clientId,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error_description || json.error || `token exchange ${res.status}`);
  }
  const email = await fetchEmail(json.access_token);
  const granted = String(json.scope || '');
  saveTokens({
    access_token: json.access_token,
    refresh_token: json.refresh_token || (loadTokens() || {}).refresh_token,
    expiry: Date.now() + Number(json.expires_in || 3600) * 1000,
    token_type: json.token_type || 'Bearer',
    scope: granted || SCOPE,
    modify: granted ? scopeAllowsModify(granted) : true,
    email: email || (loadTokens() || {}).email || '',
    web: false,
    signed_in_at: new Date().toISOString(),
  });
  return loadTokens();
}

async function refreshTokens(prev) {
  const { clientId, clientSecret } = credentials();
  if (!prev || !prev.refresh_token) return null;
  const body = new URLSearchParams({
    refresh_token: prev.refresh_token,
    client_id: clientId,
    grant_type: 'refresh_token',
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error_description || json.error || 'Gmail session expired — sign in again.');
  }
  saveTokens({
    ...prev,
    access_token: json.access_token,
    expiry: Date.now() + Number(json.expires_in || 3600) * 1000,
    token_type: json.token_type || prev.token_type,
    refresh_token: json.refresh_token || prev.refresh_token,
  });
  return loadTokens();
}

async function accessToken() {
  loadDotEnv();
  let tokens = loadTokens();
  if (!tokens) return null;
  if (tokens.access_token && tokens.expiry && Date.now() < tokens.expiry - 60_000) {
    if (!tokens.scope) await rememberGrantedScope(tokens.access_token);
    return tokens.access_token;
  }
  if (!tokens.refresh_token) return null;
  tokens = await refreshTokens(tokens);
  if (tokens && tokens.access_token) await rememberGrantedScope(tokens.access_token);
  return tokens && tokens.access_token;
}

function saveWebSession(email) {
  saveTokens({
    email: email || signedInEmail() || '',
    web: true,
    signed_in_at: new Date().toISOString(),
  });
}

module.exports = {
  SCOPE,
  GMAIL_LOGIN,
  credentials,
  oauthReady,
  redirectUri,
  connected,
  signedInEmail,
  authUrl,
  exchangeCode,
  accessToken,
  loadTokens,
  saveTokens,
  saveWebSession,
  signOut,
  scopeAllowsModify,
  canModifyMail,
  needsModifyConsent,
};
