const { FIRST_SYNC_Q } = require('./gmail');
const { stripHtml } = require('./gmail');

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

module.exports = {
  EMAIL_JS,
  THREAD_IDS_JS,
  searchUrl,
  printUrl,
  parsePrintView,
  inboxUrl,
};
