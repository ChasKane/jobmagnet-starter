const { listLiveJobs } = require('../live-jobs');
const { getRecord, statusOf, appendEvent } = require('../process-store');
const { classifyRejection, planFiling } = require('./classify-rejection');
const { matchCompany } = require('./match-company');
const { addQueue, removeQueue, getQueueItem, listQueue } = require('./queue');
const {
  loadIndex,
  saveIndex,
  loadSync,
  saveSync,
  hashText,
  findByHash,
  writeScratch,
  clearScratch,
  writeKept,
  readKept,
  hasKept,
  listKept,
  isInterviewTrack,
  indexRow,
} = require('./cache');
const { accessToken, connected, signedInEmail, canModifyMail, saveTokens } = require('./oauth');
const { getProfile, listAllNewIds, listHistoryIds, listInboxArchiveIds, getMessage, archiveMessages } = require('./gmail');

function shouldArchiveRow(row) {
  if (!row) return false;
  if (row.verdict === 'reject' || row.verdict === 'received') return true;
  return row.reason === 'received';
}

function filingBucket(row) {
  if (!row) return '';
  if (row.verdict === 'reject' || row.bucket === 'reject') return 'reject';
  if (shouldArchiveRow(row)) return 'received';
  return '';
}

function collectFiling(index, archive) {
  const filing = new Map();
  for (const row of archive || []) filing.set(row.id, row.bucket || filingBucket(row) || 'received');
  for (const [id, row] of Object.entries(index || {})) {
    if (!row || row.filed || filing.has(id)) continue;
    const bucket = filingBucket(row);
    if (bucket) filing.set(id, bucket);
  }
  return filing;
}

function loadJobRows() {
  const jobs = listLiveJobs();
  if (require('../store/mode').isSupabase()) {
    const persist = require('../../packages/persist');
    persist.open();
    const briefs = persist.nodeStore().processBriefs(jobs.map((job) => job.url));
    return jobs.map((job) => {
      const record = (briefs && briefs.get(job.url)) || { status: job.status || 'open', events: [] };
      return {
        url: job.url,
        company: job.company || job.name,
        title: job.title || '',
        status: record.status || job.status || 'open',
        record,
      };
    });
  }
  return jobs.map((j) => ({
    url: j.url,
    company: j.company || j.name,
    title: j.title || '',
    status: statusOf(j.url),
    record: getRecord(j.url),
  }));
}

function companyInterviewTrack(jobs, company, url) {
  const rows = jobs || [];
  const wanted = String(company || '').toLowerCase();
  const recordOf = (row) => {
    if (!row) return null;
    if (row.record) return row.record;
    if (row.url) return getRecord(row.url);
    return null;
  };
  if (url) {
    const hit = rows.find((row) => row && row.url === url);
    if (hit ? isInterviewTrack(recordOf(hit)) : isInterviewTrack(getRecord(url))) return true;
  }
  return rows.some(
    (row) => String((row && row.company) || '').toLowerCase() === wanted && isInterviewTrack(row.record || recordOf(row))
  );
}

async function spawnLlm(payload) {
  try {
    const ev = await require('../agent-client').invoke('classify', payload, { timeout: 60000 });
    return ev.result || ev;
  } catch {
    return null;
  }
}

function decide(verdict, match, viaLlm, pause) {
  const submitted = match.submitted;
  const interviewing = match.interviewing;
  const offer = match.offer;

  if (offer.length) return { action: 'queue', reason: 'offer', url: offer[0].url, candidates: match.matches };
  if (interviewing.length) return { action: 'queue', reason: 'interviewing', url: interviewing[0].url, candidates: match.matches };

  if (verdict === 'unsure') {
    return { action: 'queue', reason: 'unsure', url: (submitted[0] || match.matches[0] || {}).url || null, candidates: match.matches };
  }

  if (viaLlm && !(submitted.length === 1 && match.unique)) {
    return { action: 'queue', reason: 'llm_only', url: (submitted[0] || {}).url || null, candidates: match.matches };
  }

  if (pause && submitted.length >= 2) {
    return { action: 'queue', reason: 'company_pause', url: null, candidates: submitted };
  }

  if (submitted.length === 1 && (match.unique || submitted.length === match.active.length)) {
    return { action: 'reject', url: submitted[0].url, candidates: submitted };
  }

  if (submitted.length >= 2) {
    return { action: 'queue', reason: 'multi_match', url: null, candidates: submitted };
  }

  if (match.matches.length >= 2 && !match.unique) {
    return { action: 'queue', reason: 'multi_match', url: null, candidates: match.matches };
  }

  if (submitted.length === 0) {
    if (match.closed.length && !match.open.length) return { action: 'skip', reason: 'already_closed' };
    return { action: 'queue', reason: 'no_submitted', url: (match.open[0] || match.matches[0] || {}).url || null, candidates: match.matches };
  }

  return { action: 'queue', reason: 'unsure', url: submitted[0].url, candidates: submitted };
}

function snippetOf(msg) {
  return String(msg.snippet || msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function inboxHref(msg) {
  const id = (msg && (msg.threadId || msg.id)) || '';
  if (!id) return 'https://mail.google.com/mail/u/0/#inbox';
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(id)}`;
}

function noticeItem(msg, cls, extra) {
  return {
    id: msg.id,
    subject: msg.subject || '',
    from: msg.from || '',
    snippet: snippetOf(msg),
    reason: (cls && cls.reason) || 'other',
    bucket: 'other',
    company: (extra && extra.company) || '',
    url: (extra && extra.url) || null,
    candidates: (extra && extra.candidates) || [],
    href: inboxHref(msg),
  };
}

function scanReply({ scanned, archivedRejects, archivedReceipts, notified, queued, needReconnect, archiveError }) {
  const parts = [`Scanned ${scanned}.`];
  const filed = [];
  if (archivedRejects) filed.push(`${archivedRejects} rejection${archivedRejects === 1 ? '' : 's'}`);
  if (archivedReceipts) filed.push(`${archivedReceipts} application receipt${archivedReceipts === 1 ? '' : 's'}`);
  if (filed.length && !needReconnect && !archiveError) {
    parts.push(`Archived ${filed.join(' and ')} out of your inbox.`);
  } else if (filed.length && needReconnect) {
    parts.push(`${filed.join(' and ')} ready to archive. Say connect gmail and allow mailbox changes.`);
  } else if (filed.length && archiveError) {
    parts.push(`Could not archive ${filed.join(' and ')} (${archiveError}).`);
  }
  if (notified) parts.push(`Notified you about ${notified} other email${notified === 1 ? '' : 's'}.`);
  if (queued === 1) parts.push('1 still needs a job match.');
  else if (queued) parts.push(`${queued} still need a job match.`);
  if (!filed.length && !notified && !queued) parts.push('Nothing new to file.');
  return parts.join(' ');
}

function applyKeep(row, msg, jobs, company, url) {
  const keep = companyInterviewTrack(jobs, company, url || row.matched_url);
  row.keep_body = keep;
  if (keep) writeKept(msg.id, msg);
  return row;
}

async function syncNewIds(token, sync, index) {
  if (sync.historyId) {
    const hist = await listHistoryIds(token, sync.historyId);
    if (!hist.stale) {
      return { ids: hist.ids.filter((id) => !index[id] || !index[id].verdict), historyId: hist.historyId };
    }
  }
  const ids = await listAllNewIds(token, index);
  let historyId = sync.historyId || null;
  try {
    const profile = await getProfile(token);
    historyId = profile.historyId ? String(profile.historyId) : historyId;
  } catch (_) {}
  return { ids, historyId };
}

async function rehydrateKept(getMsg, index, jobs) {
  if (!getMsg) return;
  for (const [id, row] of Object.entries(index)) {
    const url = row.matched_url;
    const job = url ? jobs.find((j) => j.url === url) : null;
    const rec = (job && job.record) || (url ? getRecord(url) : null);
    const company = (job && job.company) || '';
    const keep = companyInterviewTrack(jobs, company, url) || (rec && isInterviewTrack(rec));
    if (!keep) continue;
    if (row.keep_body && hasKept(id)) continue;
    try {
      const msg = await getMsg(id);
      if (!msg) continue;
      writeKept(id, msg);
      row.keep_body = true;
    } catch (err) {
      console.warn('[magnet] mail rehydrate', id, err.message || err);
    }
  }
}

async function processMessages(ids, getMsg, jobs, index) {
  const autoRejected = [];
  const queued = [];
  const archive = [];
  const notify = [];
  let skipped = 0;

  for (const id of ids) {
    if (index[id] && index[id].verdict) {
      skipped += 1;
      continue;
    }
    let msg;
    try {
      msg = await getMsg(id);
    } catch (err) {
      if (err && (err.status === 404 || /not found/i.test(String(err.message || err)))) {
        skipped += 1;
        continue;
      }
      throw err;
    }
    if (!msg) {
      skipped += 1;
      continue;
    }
    writeScratch(id, msg);
    const hash = hashText(msg.text);
    const dup = findByHash(index, hash);
    let verdict;
    let viaLlm = false;
    let match;
    let cls;

    if (dup && dup.row && dup.row.verdict) {
      verdict = dup.row.verdict;
      match = matchCompany(msg, jobs);
      cls = { verdict, reason: dup.row.reason || '', recruiting: verdict !== 'noise', pause: false };
    } else {
      const out = await classifyOne(msg, jobs);
      verdict = out.verdict;
      viaLlm = out.viaLlm;
      match = out.match;
      cls = { ...out.cls, verdict };
    }

    const company = match.extracted || (match.matches[0] && match.matches[0].company) || '';
    const row = indexRow(msg, { hash, verdict, matched_url: null, keep_body: false });
    const plan = planFiling(cls);
    if (plan.bucket === 'received') row.verdict = 'received';
    row.reason = cls.reason || '';
    row.filed = false;
    if (plan.archive) archive.push({ id, bucket: plan.bucket });

    let notice = null;
    if (plan.notify) {
      notice = noticeItem(msg, cls, { company, candidates: match.matches });
      notify.push(notice);
    }

    if (verdict === 'noise' || plan.bucket === 'received' || (verdict === 'not_reject' && !plan.notify)) {
      applyKeep(row, msg, jobs, company, null);
      index[id] = row;
      clearScratch(id);
      if (!plan.archive) skipped += 1;
      continue;
    }

    if (plan.notify && verdict === 'not_reject') {
      applyKeep(row, msg, jobs, company, null);
      index[id] = row;
      clearScratch(id);
      continue;
    }

    const decision = decide(verdict, match, viaLlm, Boolean(cls.pause));
    if ((decision.reason === 'offer' || decision.reason === 'interviewing') && !notice) {
      notice = noticeItem(msg, { ...cls, reason: decision.reason }, { company, candidates: decision.candidates || match.matches });
      notify.push(notice);
    }
    if (notice) {
      notice.url = decision.url || null;
      notice.candidates = decision.candidates || match.matches;
      if (decision.reason === 'offer' || decision.reason === 'interviewing') notice.reason = decision.reason;
    }
    if (decision.action === 'reject') {
      appendEvent(decision.url, {
        type: 'rejected',
        title: 'Rejected',
        body: `${msg.subject || 'Rejection'} (${id})`,
      });
      row.matched_url = decision.url;
      applyKeep(row, msg, jobs, company, decision.url);
      autoRejected.push({ id, url: decision.url, subject: msg.subject, company });
    } else if (decision.action === 'queue') {
      row.matched_url = decision.url || null;
      applyKeep(row, msg, jobs, company, decision.url);
      addQueue({
        id,
        reason: decision.reason,
        bucket: plan.bucket,
        subject: msg.subject || '',
        from: msg.from || '',
        date: msg.date || '',
        snippet: snippetOf(msg),
        company,
        candidates: decision.candidates || match.matches,
      });
      queued.push({
        id,
        reason: decision.reason,
        bucket: plan.bucket,
        subject: msg.subject,
        from: msg.from || '',
        snippet: snippetOf(msg),
        company,
        url: decision.url || null,
        candidates: decision.candidates || match.matches,
        decision,
      });
    } else {
      applyKeep(row, msg, jobs, company, null);
      skipped += 1;
    }

    index[id] = row;
    clearScratch(id);
  }

  return { autoRejected, queued, skipped, archive, notify };
}

async function classifyOne(msg, jobs) {
  const cls = classifyRejection(msg);
  let verdict = cls.verdict;
  let viaLlm = false;
  let llm = null;
  const match = matchCompany(msg, jobs);

  if (verdict === 'unsure' && cls.recruiting && match.active.length) {
    if (process.env.CURSOR_API_KEY) {
      llm = await spawnLlm({
        from: msg.from,
        subject: msg.subject,
        text: msg.text,
        candidates: match.matches.slice(0, 8),
      });
      if (llm && (llm.verdict === 'reject' || llm.verdict === 'not_reject' || llm.verdict === 'unsure')) {
        viaLlm = llm.verdict === 'reject';
        verdict = llm.verdict;
      }
    }
  }

  return { cls, verdict, viaLlm, llm, match };
}

async function scanInbox(deps) {
  if (!connected()) {
    return { ok: false, needConnect: true, reply: 'Sign in to Gmail first.' };
  }

  const jobs = loadJobRows();
  const index = loadIndex();
  const sync = loadSync();
  let token = null;
  try {
    token = await accessToken();
  } catch (err) {
    if (!(deps && deps.listWebMessages)) {
      return { ok: false, needConnect: true, reply: String(err.message || err) };
    }
  }

  let ids = [];
  let historyId = sync.historyId || null;
  let inboxArchiveIds = [];
  let getMsg;
  if (token) {
    const syncOut = await syncNewIds(token, sync, index);
    ids = syncOut.ids;
    historyId = syncOut.historyId;
    getMsg = (id) => getMessage(token, id);
    try {
      inboxArchiveIds = await listInboxArchiveIds(token);
    } catch (err) {
      console.warn('[magnet] mail inbox archive list:', (err && err.message) || err);
    }
    for (const id of inboxArchiveIds) {
      if (index[id] && index[id].verdict) continue;
      ids.push(id);
    }
    ids = [...new Set(ids)];
  } else if (deps && deps.listWebMessages) {
    const web = await deps.listWebMessages(index);
    ids = (web.ids || []).filter((id) => !index[id] || !index[id].verdict);
    getMsg = web.getMessage;
  } else {
    return { ok: false, needConnect: true, reply: 'Sign in to Gmail first.' };
  }

  const { autoRejected, queued, skipped, archive, notify } = await processMessages(ids, getMsg, jobs, index);
  const extra = inboxArchiveIds
    .filter((id) => shouldArchiveRow(index[id]))
    .map((id) => ({ id, bucket: filingBucket(index[id]) }));
  const filing = collectFiling(index, [...(archive || []), ...extra]);

  let archivedRejects = 0;
  let archivedReceipts = 0;
  for (const bucket of filing.values()) {
    if (bucket === 'reject') archivedRejects += 1;
    else if (bucket === 'received') archivedReceipts += 1;
  }

  let needReconnect = false;
  let archiveError = '';
  const wanted = archivedRejects + archivedReceipts;
  if (wanted && token && canModifyMail()) {
    const filed = await archiveMessages(token, [...filing.keys()]);
    if (filed.ok) {
      for (const id of filing.keys()) {
        if (index[id]) index[id].filed = true;
      }
    } else if (filed.needReconnect) {
      needReconnect = true;
      saveTokens({ modify: false });
    } else {
      archiveError = filed.error || 'archive failed';
    }
  } else if (wanted && !canModifyMail()) {
    needReconnect = true;
  } else if (wanted && !token) {
    archiveError = 'Gmail API sign-in required';
  }

  await rehydrateKept(getMsg, index, jobs);
  saveIndex(index);
  saveSync({
    historyId,
    scanned_at: new Date().toISOString(),
    indexed: Object.keys(index).length,
    pending: listQueue().length,
    connected: connected(),
    email: signedInEmail(),
  });

  const reply = scanReply({
    scanned: ids.length,
    archivedRejects,
    archivedReceipts,
    notified: notify.length,
    queued: queued.filter((row) => row.bucket !== 'other' && row.reason !== 'offer' && row.reason !== 'interviewing').length,
    needReconnect,
    archiveError,
  });
  return {
    ok: true,
    autoRejected,
    queued,
    skipped,
    notify,
    archivedRejects,
    archivedReceipts,
    needReconnect,
    scanned: ids.length,
    reply,
    pending: listQueue(),
  };
}

function resolveQueue(id, action) {
  const item = getQueueItem(id);
  if (!item) return { ok: false, error: 'not in queue' };
  const index = loadIndex();
  const row = index[id] || {};
  let rejected = [];

  if (action === 'no') {
    row.verdict = row.verdict || 'not_reject';
  } else {
    let urls = [];
    if (action === 'yes') {
      urls = item.candidates && item.candidates[0] ? [item.candidates[0].url] : item.url ? [item.url] : [];
    } else if (action === 'all') {
      urls = (item.candidates || []).map((c) => c.url).filter(Boolean);
    } else if (/^https?:\/\//i.test(String(action || ''))) {
      urls = [action];
    } else {
      return { ok: false, error: 'action must be yes|no|all|<url>' };
    }
    for (const url of urls) {
      appendEvent(url, { type: 'rejected', title: 'Rejected', body: `${item.subject || 'Rejection'} (${id})` });
      rejected.push(url);
    }
    row.verdict = 'reject';
    row.matched_url = urls[0] || row.matched_url;
    const rec = urls[0] ? getRecord(urls[0]) : null;
    if (rec && isInterviewTrack(rec)) row.keep_body = true;
  }

  index[id] = row;
  saveIndex(index);
  removeQueue(id);
  return { ok: true, rejected, pending: listQueue() };
}

function mailStatus() {
  const sync = loadSync();
  return {
    connected: connected(),
    email: signedInEmail(),
    historyId: sync.historyId || null,
    scanned_at: sync.scanned_at || null,
    indexed: Object.keys(loadIndex()).length,
    pending: listQueue(),
  };
}

function mailForJob(url, company) {
  const index = loadIndex();
  const pending = listQueue().filter((row) => {
    if ((row.candidates || []).some((c) => c.url === url)) return true;
    if (row.company && company && String(row.company).toLowerCase() === String(company).toLowerCase()) return true;
    return false;
  });
  const kept = [];
  for (const id of listKept()) {
    const row = index[id];
    if (row && row.matched_url === url) {
      const msg = readKept(id);
      if (msg) kept.push({ id, from: msg.from, subject: msg.subject, date: msg.date, text: msg.text });
    }
  }
  if (company && !kept.length) {
    const foldCo = String(company).toLowerCase();
    for (const id of listKept()) {
      const msg = readKept(id);
      if (!msg) continue;
      const hay = `${msg.from} ${msg.subject} ${msg.text}`.toLowerCase();
      if (hay.includes(foldCo)) kept.push({ id, from: msg.from, subject: msg.subject, date: msg.date, text: msg.text });
    }
  }
  kept.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const status = mailStatus();
  return {
    pending: status.pending,
    jobPending: pending,
    kept,
    connected: status.connected,
    email: status.email,
    scanned_at: status.scanned_at,
    indexed: status.indexed,
  };
}

module.exports = {
  scanInbox,
  resolveQueue,
  mailStatus,
  mailForJob,
  decide,
  loadJobRows,
  scanReply,
  noticeItem,
  shouldArchiveRow,
  collectFiling,
  processMessages,
};
