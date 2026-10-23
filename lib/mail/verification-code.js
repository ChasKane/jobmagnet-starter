const { listMessageIds, getMessage } = require('./gmail');

/** A code-shaped token: 6–10 letters or digits, not an ordinary word. */
function tokenLike(raw) {
  const s = String(raw || '').trim();
  if (!/^[A-Za-z0-9]{6,10}$/.test(s)) return false;
  const lower = s.toLowerCase();
  if (/^(required|continue|greenhouse|application|security|verification|confirmation|please|confirm|before|character)$/.test(lower)) {
    return false;
  }
  if (/\d/.test(s)) return true;
  return s === s.toUpperCase();
}

function greenhouseCode(raw) {
  const s = String(raw || '').trim();
  if (!/^[A-Za-z0-9]{8}$/.test(s)) return false;
  const lower = s.toLowerCase();
  if (/^(required|continue|greenhouse|application|security|verification|confirmation|please|confirm|before|character)$/.test(lower)) {
    return false;
  }
  return true;
}

function extractVerificationCode(text) {
  const raw = String(text || '');
  const greenhouse = [
    /security code field on your application\s*[:\-]?\s*(?:\r?\n)+\s*([A-Za-z0-9]{8})\b/i,
    /security code field on your application\s*:\s*([A-Za-z0-9]{8})\b/i,
  ];
  for (const re of greenhouse) {
    const match = raw.match(re);
    if (match && greenhouseCode(match[1])) return match[1];
  }
  const src = raw.replace(/\s+/g, ' ');
  const labeled = [
    /(?:verification|security|confirmation)\s+code(?:\s+is)?\s*[:\-]?\s*([A-Za-z0-9]{6,10})\b/i,
    /\b(?:your\s+)?code\s*(?:is|:)\s*([A-Za-z0-9]{6,10})\b/i,
    /\b8-character code\s*(?:is|:)?\s*([A-Za-z0-9]{8})\b/i,
  ];
  for (const re of labeled) {
    const match = src.match(re);
    if (match && tokenLike(match[1])) return match[1];
  }
  const nearRe = /\bcode\b.{0,120}?\b([A-Za-z0-9]{6,10})\b/gi;
  let near;
  while ((near = nearRe.exec(src))) {
    if (tokenLike(near[1])) return near[1];
  }
  return '';
}

function codeQuery({ company, since } = {}) {
  const when = since ? new Date(since).getTime() : Date.now() - 15 * 60 * 1000;
  const after = Math.floor(when / 1000) - 120;
  const parts = [
    `after:${after}`,
    '("verification code" OR "security code" OR "your code is" OR "confirm you\'re a human")',
  ];
  const name = String(company || '').replace(/"/g, '').trim();
  if (name) parts.push(`"${name}"`);
  return parts.join(' ');
}

function pickVerificationCode(messages, { since, company } = {}) {
  const cutoff = since ? new Date(since).getTime() - 120000 : 0;
  const ranked = (messages || [])
    .map((message) => ({
      ...message,
      code: extractVerificationCode(`${message.subject || ''}\n${message.text || ''}\n${message.snippet || ''}`),
    }))
    .filter((message) => message.code)
    .filter((message) => !cutoff || new Date(message.date).getTime() >= cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!ranked.length) return null;
  const pack = (message) => ({
    code: message.code,
    from: message.from || '',
    subject: message.subject || '',
    date: message.date,
  });
  const name = String(company || '').trim().toLowerCase();
  if (name) {
    const hit = ranked.find((message) => `${message.from} ${message.subject} ${message.text}`.toLowerCase().includes(name));
    if (hit) return pack(hit);
    if (ranked.length > 1) return null;
  }
  return pack(ranked[0]);
}

async function fetchGmailCodeMessages(token, opts) {
  const page = await listMessageIds(token, { q: codeQuery(opts) });
  const ids = (page.messages || []).slice(0, 6).map((message) => message.id).filter(Boolean);
  const messages = [];
  for (const id of ids) messages.push(await getMessage(token, id));
  return messages;
}

module.exports = {
  tokenLike,
  extractVerificationCode,
  codeQuery,
  pickVerificationCode,
  fetchGmailCodeMessages,
};
