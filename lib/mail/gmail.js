const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

const FIRST_SYNC_Q =
  'newer_than:90d (from:greenhouse-mail.io OR from:lever.co OR from:ashbyhq.com OR from:myworkday.com OR from:smartrecruiters.com OR subject:application OR unfortunately OR "not moving forward" OR "other candidates" OR "your candidacy" OR "not selected" OR "we\'ve received" OR "we have received" OR "we received your application" OR "application received" OR "thanks for applying" OR "thank you for applying")';

const ARCHIVE_INBOX_Q =
  'in:inbox newer_than:90d ("we\'ve received your application" OR "we have received your application" OR "we received your application" OR "application received" OR "we\'ve decided not to" OR "we have decided not to" OR "not moving forward" OR "not be moving forward" OR "other candidates" OR "not selected")';

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

function b64url(data) {
  if (!data) return '';
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function walkParts(part, acc) {
  if (!part) return acc;
  const mime = String(part.mimeType || '');
  const data = part.body && part.body.data;
  if (data && mime === 'text/plain' && !acc.plain) acc.plain = b64url(data);
  if (data && mime === 'text/html' && !acc.html) acc.html = b64url(data);
  for (const child of part.parts || []) walkParts(child, acc);
  return acc;
}

function header(headers, name) {
  const want = String(name).toLowerCase();
  const row = (headers || []).find((h) => String(h.name || '').toLowerCase() === want);
  return row ? String(row.value || '') : '';
}

function decodeMessage(raw) {
  const payload = raw.payload || {};
  const headers = payload.headers || [];
  const acc = walkParts(payload, { plain: '', html: '' });
  if (!acc.plain && payload.body && payload.body.data && String(payload.mimeType || '').startsWith('text/plain')) {
    acc.plain = b64url(payload.body.data);
  }
  if (!acc.html && payload.body && payload.body.data && String(payload.mimeType || '').includes('html')) {
    acc.html = b64url(payload.body.data);
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

async function getProfile(token) {
  return gmailGet(token, '/profile');
}

async function listMessageIds(token, { q, pageToken } = {}) {
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
      if (m.id && !known[m.id]) ids.push(m.id);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
}

async function listInboxArchiveIds(token) {
  const ids = [];
  let pageToken;
  do {
    const page = await listMessageIds(token, { q: ARCHIVE_INBOX_Q, pageToken });
    for (const m of page.messages || []) {
      if (m.id) ids.push(m.id);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return [...new Set(ids)];
}

async function listHistoryIds(token, startHistoryId) {
  const ids = [];
  let pageToken;
  let historyId = startHistoryId;
  try {
    do {
      const page = await gmailGet(token, '/history', {
        startHistoryId,
        historyTypes: 'messageAdded',
        pageToken,
      });
      historyId = page.historyId || historyId;
      for (const h of page.history || []) {
        for (const added of h.messagesAdded || []) {
          if (added.message && added.message.id) ids.push(added.message.id);
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return { ids: [...new Set(ids)], historyId: String(historyId || startHistoryId) };
  } catch (err) {
    if (err.status === 404 || /not found/i.test(String(err.message || err))) {
      return { stale: true, ids: [], historyId: null };
    }
    throw err;
  }
}

async function getMessage(token, id) {
  const raw = await gmailGet(token, `/messages/${encodeURIComponent(id)}`, { format: 'full' });
  return decodeMessage(raw);
}

const ARCHIVE_LABELS = ['UNREAD', 'INBOX'];

function archiveBody(ids) {
  return {
    ids: [...new Set((ids || []).filter(Boolean))],
    removeLabelIds: ARCHIVE_LABELS.slice(),
  };
}

async function gmailSend(token, pathname, body, fetchImpl) {
  const send = fetchImpl || fetch;
  const res = await send(GMAIL + pathname, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
  }
  if (!res.ok) {
    const err = new Error(json.error && json.error.message ? json.error.message : `gmail ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function archiveMessages(token, ids, opts) {
  const body = archiveBody(ids);
  if (!token || !body.ids.length) return { ok: true, archived: 0 };
  const fetchImpl = opts && opts.fetchImpl;
  const chunkSize = (opts && opts.chunkSize) || 1000;
  let archived = 0;
  try {
    for (let i = 0; i < body.ids.length; i += chunkSize) {
      const idsChunk = body.ids.slice(i, i + chunkSize);
      await gmailSend(token, '/messages/batchModify', { ids: idsChunk, removeLabelIds: body.removeLabelIds }, fetchImpl);
      archived += idsChunk.length;
    }
    return { ok: true, archived };
  } catch (err) {
    const status = err && err.status;
    if (status === 403 || status === 401) {
      return { ok: false, needReconnect: true, archived: 0, error: err.message || String(err) };
    }
    return { ok: false, archived: 0, error: err.message || String(err) };
  }
}

module.exports = {
  FIRST_SYNC_Q,
  ARCHIVE_INBOX_Q,
  ARCHIVE_LABELS,
  archiveBody,
  decodeMessage,
  stripHtml,
  getProfile,
  listMessageIds,
  listAllNewIds,
  listInboxArchiveIds,
  listHistoryIds,
  getMessage,
  archiveMessages,
};
