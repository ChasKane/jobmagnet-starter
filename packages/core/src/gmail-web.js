const FIRST_SYNC_Q =
  'newer_than:90d (from:greenhouse-mail.io OR from:lever.co OR from:ashbyhq.com OR from:myworkday.com OR from:smartrecruiters.com OR subject:application OR unfortunately OR "not moving forward" OR "other candidates" OR "your candidacy" OR "not selected" OR "we\'ve received" OR "we have received" OR "we received your application" OR "application received" OR "thanks for applying" OR "thank you for applying")';

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

const EMAIL_JS = `(() => {
  const nodes = [
    ...document.querySelectorAll('[data-email]'),
    ...document.querySelectorAll('a[aria-label*="@"]'),
    ...document.querySelectorAll('div[aria-label*="@"]'),
  ];
  for (const n of nodes) {
    const raw = n.getAttribute('data-email') || n.getAttribute('aria-label') || n.textContent || '';
    const m = String(raw).match(/[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}/i);
    if (m) return m[0];
  }
  const t = document.title || '';
  const m = t.match(/[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}/i);
  return m ? m[0] : '';
})()`;

const THREAD_IDS_JS = `(() => {
  const ids = new Set();
  for (const el of document.querySelectorAll('[data-legacy-thread-id], [data-thread-id]')) {
    const id = el.getAttribute('data-legacy-thread-id') || el.getAttribute('data-thread-id');
    if (id) ids.add(id);
  }
  return [...ids];
})()`;

const PRINT_HTML_JS = `(() => document.documentElement.outerHTML)()`;

function searchUrl(q) {
  return 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(q || FIRST_SYNC_Q);
}

function printUrl(threadId) {
  return 'https://mail.google.com/mail/u/0/?ui=2&view=pt&search=all&th=' + encodeURIComponent(threadId);
}

function parsePrintView(html, threadId) {
  const text = stripHtml(html);
  const from = (text.match(/From:\s*(.+)/i) || [])[1] || '';
  const subject = (text.match(/Subject:\s*(.+)/i) || [])[1] || '';
  const dateRaw = (text.match(/Date:\s*(.+)/i) || [])[1] || '';
  let date = new Date().toISOString();
  const parsed = Date.parse(dateRaw);
  if (!Number.isNaN(parsed)) date = new Date(parsed).toISOString();
  return {
    id: threadId,
    threadId,
    from: from.trim().slice(0, 200),
    subject: subject.trim().slice(0, 300),
    date,
    snippet: text.slice(0, 240),
    text,
  };
}

function inboxUrl(url) {
  try {
    const u = new URL(url);
    if (!/mail\.google\.com$/i.test(u.hostname.replace(/^www\./, ''))) return false;
    if (/ServiceLogin|signin|AccountChooser/i.test(u.href)) return false;
    return /\/mail\//i.test(u.pathname) || u.pathname === '/' || u.pathname === '';
  } catch {
    return false;
  }
}

function oauthCallbackParams(url) {
  try {
    const u = new URL(String(url || ''));
    const loopback = u.hostname === '127.0.0.1' && /\/mail\/oauth\/callback$/i.test(u.pathname);
    const scheme = u.protocol === 'jobmagnet:' && /oauth/i.test(u.host + u.pathname);
    if (!loopback && !scheme) return null;
    return {
      code: u.searchParams.get('code') || '',
      error: u.searchParams.get('error') || '',
      email: u.searchParams.get('email') || '',
    };
  } catch {
    return null;
  }
}

module.exports = {
  FIRST_SYNC_Q,
  stripHtml,
  EMAIL_JS,
  THREAD_IDS_JS,
  PRINT_HTML_JS,
  searchUrl,
  printUrl,
  parsePrintView,
  inboxUrl,
  oauthCallbackParams,
};
