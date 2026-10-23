const { stripHtml } = require('./gmail-web');

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const SCOPE = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');
const LOOPBACK_REDIRECT = 'http://127.0.0.1:3871/mail/oauth/callback';
const APP_REDIRECT = 'jobmagnet://mail-oauth';

function b64urlDecode(data) {
  const s = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const str = s + pad;
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'base64').toString('utf8');
  const bin = globalThis.atob(str);
  try {
    return decodeURIComponent(
      Array.from(bin, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
    );
  } catch {
    return bin;
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function gmailGet(token, pathname, params) {
  const u = new URL(GMAIL + pathname);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  const res = await fetch(u, { headers: authHeaders(token) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error && json.error.message ? json.error.message : `gmail ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function header(headers, name) {
  const want = String(name).toLowerCase();
  const row = (headers || []).find((h) => String(h.name || '').toLowerCase() === want);
  return row ? String(row.value || '') : '';
}

function walkParts(part, acc) {
  if (!part) return acc;
  const mime = String(part.mimeType || '');
  const data = part.body && part.body.data;
  if (data && mime === 'text/plain' && !acc.plain) acc.plain = b64urlDecode(data);
  if (data && mime === 'text/html' && !acc.html) acc.html = b64urlDecode(data);
  for (const child of part.parts || []) walkParts(child, acc);
  return acc;
}

function decodeMessage(raw) {
  const payload = raw.payload || {};
  const headers = payload.headers || [];
  const acc = walkParts(payload, { plain: '', html: '' });
  if (!acc.plain && payload.body && payload.body.data && String(payload.mimeType || '').startsWith('text/plain')) {
    acc.plain = b64urlDecode(payload.body.data);
  }
  if (!acc.html && payload.body && payload.body.data && String(payload.mimeType || '').includes('html')) {
    acc.html = b64urlDecode(payload.body.data);
  }
  const text = acc.plain || stripHtml(acc.html);
  const dateMs = raw.internalDate ? Number(raw.internalDate) : Date.parse(header(headers, 'Date')) || Date.now();
  return {
    id: raw.id,
    threadId: raw.threadId || '',
    from: header(headers, 'From'),
    subject: header(headers, 'Subject'),
    date: new Date(dateMs).toISOString(),
    snippet: raw.snippet || '',
    text,
  };
}

function authUrl({ clientId, redirectUri, email, forceConsent, state } = {}) {
  if (!clientId) return null;
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri || LOOPBACK_REDIRECT);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('include_granted_scopes', 'true');
  if (email) u.searchParams.set('login_hint', email);
  if (state) u.searchParams.set('state', state);
  u.searchParams.set('prompt', forceConsent ? 'consent' : 'select_account');
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

async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const body = new URLSearchParams({
    code: String(code || ''),
    client_id: clientId,
    redirect_uri: redirectUri || LOOPBACK_REDIRECT,
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
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token || '',
    expiry: Date.now() + Number(json.expires_in || 3600) * 1000,
    token_type: json.token_type || 'Bearer',
    scope: json.scope || SCOPE,
    email,
    web: false,
    signed_in_at: new Date().toISOString(),
  };
}

async function refreshTokens({ clientId, clientSecret, tokens }) {
  if (!tokens || !tokens.refresh_token) return null;
  const body = new URLSearchParams({
    refresh_token: tokens.refresh_token,
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
  return {
    ...tokens,
    access_token: json.access_token,
    expiry: Date.now() + Number(json.expires_in || 3600) * 1000,
    refresh_token: json.refresh_token || tokens.refresh_token,
  };
}

async function accessToken({ clientId, clientSecret, tokens }) {
  if (!tokens) return null;
  if (tokens.access_token && tokens.expiry && Date.now() < tokens.expiry - 60_000) return tokens.access_token;
  if (!tokens.refresh_token) return tokens.access_token || null;
  const next = await refreshTokens({ clientId, clientSecret, tokens });
  return next && next.access_token;
}

async function getProfile(token) {
  return gmailGet(token, '/profile');
}

async function listMessageIds(token, { q, pageToken } = {}) {
  const { FIRST_SYNC_Q } = require('./gmail-web');
  return gmailGet(token, '/messages', {
    q: q || FIRST_SYNC_Q,
    maxResults: 100,
    pageToken,
  });
}

async function listAllNewIds(token, known) {
  const ids = [];
  let pageToken;
  do {
    const page = await listMessageIds(token, { pageToken });
    for (const m of page.messages || []) {
      if (m.id && !(known && known[m.id])) ids.push(m.id);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
}

async function getMessage(token, id) {
  const raw = await gmailGet(token, `/messages/${encodeURIComponent(id)}`, { format: 'full' });
  return decodeMessage(raw);
}

function hasApiTokens(tokens) {
  return Boolean(tokens && (tokens.refresh_token || tokens.access_token) && !tokens.web);
}

module.exports = {
  SCOPE,
  LOOPBACK_REDIRECT,
  APP_REDIRECT,
  b64urlDecode,
  decodeMessage,
  authUrl,
  exchangeCode,
  refreshTokens,
  accessToken,
  fetchEmail,
  getProfile,
  listAllNewIds,
  getMessage,
  hasApiTokens,
};
