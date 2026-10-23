function titleFromHost(hostname) {
  const host = String(hostname || '').replace(/^www\./, '');
  const base = host.split('.')[0] || host || 'Link';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const { companySlug } = require('./company-hold');

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

function filterBucket(status) {
  if (!status || status === 'open') return 'open';
  if (status === 'rejected') return 'rejected';
  if (status === 'passed') return 'passed';
  return 'submitted';
}

function shapeJob(job, index = 0) {
  const url = String((job && job.url) || '').trim();
  let hostname = '';
  try {
    hostname = new URL(url).hostname || '';
  } catch {
    hostname = '';
  }
  const company = String((job && (job.company || job.name)) || '').trim();
  const title = String((job && job.title) || '').trim();
  return {
    id: job && job.id ? String(job.id) : `tab-${index}`,
    url,
    company,
    title,
    name: company || title || titleFromHost(hostname),
    linkedin: job && job.linkedin ? String(job.linkedin) : '',
    posting: job && job.posting ? String(job.posting) : job && job.linkedin ? String(job.linkedin) : '',
    logo: (job && job.logo) || logoForCompany(company, url, job && job.domain),
    hostname: (job && job.hostname) || hostname,
    salary: job && job.salary ? String(job.salary) : '',
    yoe: job && job.yoe ? String(job.yoe) : '',
    level: job && job.level ? String(job.level) : '',
    industries: Array.isArray(job && job.industries) ? job.industries : [],
    skills: Array.isArray(job && job.skills) ? job.skills : [],
    notes: job && job.notes ? String(job.notes) : '',
  };
}

function urlsFromText(text) {
  const body = String(text || '');
  const found = body.match(/https?:\/\/[^\s<>"']+/gi) || [];
  return [...new Set(found.map((u) => u.replace(/[.,);]+$/, '')))];
}

function urlKeys(...vals) {
  const out = [];
  const seen = new Set();
  const add = (value) => {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  for (const val of vals) {
    if (!val) continue;
    if (typeof val === 'string') add(val);
    else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') add(item);
        else if (item && typeof item === 'object') {
          add(item.url);
          add(item.linkedin);
          add(item.posting);
        }
      }
    } else if (typeof val === 'object') {
      add(val.url);
      add(val.linkedin);
      add(val.posting);
    }
  }
  return out;
}

function jobHasUrl(job, urls) {
  const want = urls instanceof Set ? urls : new Set(urlKeys(urls));
  if (!job || !want.size) return false;
  return want.has(job.url) || (job.linkedin && want.has(job.linkedin)) || (job.posting && want.has(job.posting));
}

module.exports = {
  titleFromHost,
  companyDomainGuess,
  logoForCompany,
  filterBucket,
  shapeJob,
  urlsFromText,
  urlKeys,
  jobHasUrl,
};
