/** One posting across hosts, and one company plus title across boards. */

function canonicalUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    return text.toLowerCase();
  }
  const ghJid = url.searchParams.get('gh_jid');
  if (ghJid && /^\d+$/.test(ghJid)) return `gh:${ghJid}`;
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const path = url.pathname.replace(/\/+$/, '');
  const greenhouseHost =
    host === 'boards.greenhouse.io' ||
    host === 'job-boards.greenhouse.io' ||
    host.endsWith('.greenhouse.io');
  if (greenhouseHost) {
    const id = (path.match(/\/jobs\/(\d+)/i) || [])[1];
    if (id) return `gh:${id}`;
  }
  if (host === 'jobs.lever.co') {
    const lever = path.match(/^\/([^/]+)\/([0-9a-f-]{8,})/i);
    if (lever) return `lever:${lever[1].toLowerCase()}:${lever[2].toLowerCase()}`;
  }
  if (host === 'jobs.ashbyhq.com') {
    const ashby = path.match(/^\/([^/]+)\/([0-9a-f-]{8,})/i);
    if (ashby) return `ashby:${ashby[1].toLowerCase()}:${ashby[2].toLowerCase()}`;
  }
  if (/linkedin\.com$/i.test(host)) {
    const li = path.match(/\/jobs\/view\/(\d+)/);
    if (li) return `li:${li[1]}`;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|gh_src|source|ref|trk)$/i.test(key)) url.searchParams.delete(key);
  }
  const search = url.searchParams.toString();
  return `${host}${path}${search ? `?${search}` : ''}`.toLowerCase();
}

function companyKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(incorporated|inc|l\.l\.c|llc|ltd|limited|corp|corporation|company)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function postingKey(job) {
  const company = companyKey(job && job.company);
  const title = titleKey(job && job.title);
  if (!company || !title) return '';
  return `${company}|${title}`;
}

function indexJobs(jobs) {
  const byCanon = new Map();
  const byPosting = new Map();
  for (const job of jobs || []) {
    if (!job) continue;
    for (const key of [canonicalUrl(job.url), canonicalUrl(job.linkedin), canonicalUrl(job.posting)]) {
      if (key) byCanon.set(key, job);
    }
    const key = postingKey(job);
    if (key && !byPosting.has(key)) byPosting.set(key, job);
  }
  return { byCanon, byPosting };
}

function urlsOf(job) {
  return [canonicalUrl(job && job.url), canonicalUrl(job && job.linkedin), canonicalUrl(job && job.posting)].filter(Boolean);
}

function sameUrl(candidate, index) {
  if (!index) return null;
  for (const key of urlsOf(candidate)) {
    if (index.byCanon.has(key)) return index.byCanon.get(key);
  }
  return null;
}

function duplicateOf(candidate, index) {
  const byUrl = sameUrl(candidate, index);
  if (byUrl) return { job: byUrl, reason: 'same posting url' };
  const key = postingKey(candidate);
  if (key && index && index.byPosting.has(key)) {
    return { job: index.byPosting.get(key), reason: 'same company and title' };
  }
  return null;
}

module.exports = {
  canonicalUrl,
  companyKey,
  titleKey,
  postingKey,
  indexJobs,
  sameUrl,
  duplicateOf,
};
