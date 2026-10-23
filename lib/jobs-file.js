const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const yaml = require('js-yaml');
const { canonicalUrl, indexJobs } = require('./job-identity');

const DEFAULT_JOBS_FILE = path.join(__dirname, '..', 'knowledge', 'jobs.yaml');

function titleFromHost(hostname) {
  const host = String(hostname || '').replace(/^www\./, '');
  const base = host.split('.')[0] || host || 'Link';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const { companySlug } = require('../packages/core/src/company-hold');

function companyDomainGuess(company) {
  const slug = companySlug(company);
  return slug ? `${slug}.com` : '';
}

function logoForCompany(company, url, domain) {
  const host = domain || companyDomainGuess(company);
  if (host) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return '';
    if (/linkedin\.com$/i.test(parsed.hostname.replace(/^www\./, ''))) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`;
  } catch {
    return '';
  }
}

function resolveUrl(url, fileDir) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('file://__SAMPLES__/')) {
    const rel = url.slice('file://__SAMPLES__/'.length);
    return pathToFileURL(path.join(fileDir, '..', 'samples', rel)).href;
  }
  return url;
}

function loadJobsFile(filePath) {
  const abs = path.resolve(filePath);
  const fileDir = path.dirname(abs);
  const doc = yaml.load(fs.readFileSync(abs, 'utf8')) || {};
  const jobs = Array.isArray(doc.jobs) ? doc.jobs : [];
  const entries = [];

  jobs.forEach((job, index) => {
    if (!job || !job.url) return;
    const url = resolveUrl(String(job.url).trim(), fileDir);
    if (!url || !/^(https?:|file:)/i.test(url)) return;
    let hostname = '';
    try {
      const parsed = new URL(url);
      hostname = parsed.protocol === 'file:' ? 'local' : parsed.hostname;
    } catch {
      return;
    }
    const company = (job.company || '').trim();
    const title = (job.title || '').trim();
    entries.push({
      id: job.id ? String(job.id) : `tab-${index}`,
      name: company || title || titleFromHost(hostname),
      company,
      title,
      url,
      linkedin: job.linkedin ? String(job.linkedin) : '',
      posting: job.posting ? String(job.posting) : job.linkedin ? String(job.linkedin) : '',
      logo: logoForCompany(company, url, job.domain),
      hostname,
      salary: job.salary ? String(job.salary) : '',
      yoe: job.yoe ? String(job.yoe) : '',
      level: job.level ? String(job.level) : '',
      industries: Array.isArray(job.industries) ? job.industries : [],
      skills: Array.isArray(job.skills) ? job.skills : [],
      notes: job.notes ? String(job.notes) : '',
      location: job.location ? String(job.location) : '',
      agent: Boolean(job.agent),
      ai: Boolean(job.agent || job.ai),
      submitted_at: job.submitted_at ? String(job.submitted_at) : '',
    });
  });
  return entries;
}

let indexCache = { file: '', mtimeMs: -1, byCanon: new Map() };

function jobsIndex(filePath = DEFAULT_JOBS_FILE) {
  const abs = path.resolve(filePath);
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(abs).mtimeMs;
  } catch {
    return { byCanon: new Map(), byPosting: new Map(), jobs: [] };
  }
  if (indexCache.file === abs && indexCache.mtimeMs === mtimeMs) return indexCache;
  let jobs = [];
  try {
    const doc = yaml.load(fs.readFileSync(abs, 'utf8')) || {};
    jobs = Array.isArray(doc.jobs) ? doc.jobs : [];
  } catch {
    jobs = [];
  }
  indexCache = { file: abs, mtimeMs, jobs, ...indexJobs(jobs) };
  return indexCache;
}

function isAgentJob(url, filePath = DEFAULT_JOBS_FILE) {
  const key = canonicalUrl(url);
  if (!key) return false;
  const job = jobsIndex(filePath).byCanon.get(key);
  return Boolean(job && job.agent);
}

function loadJobsDoc(filePath) {
  const abs = path.resolve(filePath);
  return yaml.load(fs.readFileSync(abs, 'utf8')) || { jobs: [] };
}

function saveJobsDoc(filePath, doc) {
  fs.writeFileSync(
    filePath,
    yaml.dump(doc, { lineWidth: 100, noRefs: true, sortingKeys: false }),
    'utf8'
  );
}

module.exports = {
  DEFAULT_JOBS_FILE,
  loadJobsFile,
  loadJobsDoc,
  saveJobsDoc,
  jobsIndex,
  isAgentJob,
  logoForCompany,
  titleFromHost,
  resolveUrl,
};
