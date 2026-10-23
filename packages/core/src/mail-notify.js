const { printUrl } = require('./gmail-web');

function threadHref(id) {
  const key = String(id || '').trim();
  if (!key) return 'https://mail.google.com/mail/u/0/#inbox';
  return printUrl(key);
}

function noticeLead(reason) {
  if (reason === 'offer') return 'Offer mail';
  if (reason === 'interviewing') return 'Interview-track mail';
  if (reason === 'interview') return 'Interview mail';
  if (reason === 'assessment') return 'Assessment';
  if (reason === 'inbound') return 'Recruiter reached out';
  if (reason === 'next_steps') return 'Next steps';
  return 'Mail to read';
}

function mailNotice(item, now) {
  const subject = String((item && (item.subject || item.snippet)) || 'Recruiting mail').trim() || 'Recruiting mail';
  const candidates = Array.isArray(item && item.candidates) ? item.candidates : [];
  const reason = (item && (item.reason || (item.decision && item.decision.reason))) || 'unsure';
  return {
    role: 'magnet',
    kind: 'mail',
    mailId: item && (item.id || item.threadId),
    href: (item && item.href) || threadHref(item && (item.id || item.threadId)),
    text: `${noticeLead(reason)}: ${subject}`,
    reason,
    candidates,
    at: now || Date.now(),
  };
}

function targetUrls(item) {
  const urls = [];
  const seen = new Set();
  function add(value) {
    const url = String((value && value.url) || value || '').trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  }
  if (item && item.decision && item.decision.url) add(item.decision.url);
  if (item && item.url) add(item.url);
  const list = (item && (item.candidates || (item.decision && item.decision.candidates))) || [];
  for (const row of list) add(row);
  return urls;
}

function alreadyNotified(msgs, mailId) {
  const id = String(mailId || '');
  if (!id) return false;
  return (msgs || []).some((m) => m && m.kind === 'mail' && String(m.mailId || '') === id);
}

function markMailRead(messages, mailId) {
  const id = String(mailId || '');
  if (!id) return messages || [];
  return (messages || []).map((m) => {
    if (m && m.kind === 'mail' && String(m.mailId || '') === id) return { ...m, read: true };
    return m;
  });
}

function unreadMailNotices(chats, jobs) {
  const jobList = Array.isArray(jobs) ? jobs : [];
  const notices = [];
  const seen = new Set();
  for (const row of chats || []) {
    const key = row.key || row.id || row.url;
    if (!key || key === '__ingest__') continue;
    const job = jobList.find((j) => j.id === key || j.url === key || j.url === row.url);
    for (const m of row.messages || []) {
      if (!m || m.kind !== 'mail' || m.read) continue;
      const mailId = String(m.mailId || '');
      const dedupe = mailId || `${key}:${m.at}:${m.text}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      notices.push({
        mailId: m.mailId,
        href: m.href,
        text: m.text,
        at: m.at,
        reason: m.reason || '',
        candidates: m.candidates || [],
        key,
        jobId: (job && job.id) || (key !== '__mail__' ? key : null),
        url: (job && job.url) || row.url || null,
        company: (job && (job.company || job.name)) || row.company || 'Mail',
        title: (job && job.title) || row.title || '',
      });
    }
  }
  notices.sort((a, b) => (b.at || 0) - (a.at || 0));
  return notices;
}

function notifyQueuedMail(store, items, clock) {
  const notices = [];
  const now = clock && typeof clock.now === 'function' ? clock.now() : Date.now();
  const jobs = typeof store.listJobs === 'function' ? store.listJobs() : [];
  for (const item of items || []) {
    const notice = mailNotice(item, now);
    const urls = targetUrls(item);
    if (!urls.length) {
      const msgs = store.getChat('__mail__');
      if (alreadyNotified(msgs, notice.mailId)) continue;
      msgs.push(notice);
      store.saveChat('__mail__', msgs);
      notices.push({ notice, key: '__mail__' });
      continue;
    }
    for (const url of urls) {
      const job = jobs.find((j) => j.url === url);
      const key = (job && job.id) || url;
      const msgs = store.getChat(key);
      if (alreadyNotified(msgs, notice.mailId)) continue;
      msgs.push(notice);
      store.saveChat(key, msgs);
      notices.push({ notice, key, url });
    }
  }
  return notices;
}

module.exports = {
  threadHref,
  mailNotice,
  targetUrls,
  notifyQueuedMail,
  alreadyNotified,
  markMailRead,
  unreadMailNotices,
};
