const { stripHtml } = require('./gmail-web');
const { normalizeSchema, toDiscoverCriteria } = require('./search-schema');
const { pickOnePerCompany, boardsToFetch } = require('./company-hold');

function boardFromUrl(href) {
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    if (/ashbyhq\.com$/.test(host) && parts[0]) {
      return { ats: 'ashby', slug: parts[0], source_url: href };
    }
    if (/(?:job-boards\.)?greenhouse\.io$/.test(host) && parts[0]) {
      return { ats: 'greenhouse', slug: parts[0], source_url: href };
    }
    if (/lever\.co$/.test(host) && parts[0]) {
      return { ats: 'lever', slug: parts[0], source_url: href };
    }
    if (/smartrecruiters\.com$/.test(host) && parts[0]) {
      return { ats: 'smartrecruiters', slug: parts[0], source_url: href };
    }
    if (/apply\.workable\.com$/.test(host) && parts[0]) {
      return { ats: 'workable', slug: parts[0], source_url: href };
    }
    if (/recruitee\.com$/.test(host)) {
      const slug = host.split('.')[0];
      if (slug && slug !== 'recruitee') return { ats: 'recruitee', slug, source_url: href };
    }
  } catch (_) {}
  return null;
}

function shapeBoard(partial, company) {
  if (!partial || !partial.ats || !partial.slug) return null;
  return {
    company: company || partial.company || partial.slug,
    ats: String(partial.ats).toLowerCase(),
    slug: String(partial.slug),
    source_url: partial.source_url || '',
  };
}

function mergeBoards(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const row = shapeBoard(raw, raw && raw.company);
    if (!row) continue;
    const key = `${row.ats}:${row.slug.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function boardsFromJobs(jobs) {
  const out = [];
  for (const job of jobs || []) {
    const b = boardFromUrl(job && (job.url || job.posting));
    if (b) out.push({ ...b, company: (job && (job.company || job.name)) || b.slug });
  }
  return mergeBoards(out);
}

function upsertBoardList(list, partial, company) {
  const next = mergeBoards(list);
  const row = shapeBoard(partial, company);
  if (!row) return next;
  const idx = next.findIndex((b) => b.ats === row.ats && b.slug.toLowerCase() === row.slug.toLowerCase());
  if (idx >= 0) {
    if (company && !next[idx].company) next[idx] = { ...next[idx], company };
    return next;
  }
  next.push(row);
  return next;
}

function matchesCriteria(job, criteria) {
  if (!criteria) return true;
  const title = String(job.title || '').toLowerCase();
  if (criteria.title_includes && criteria.title_includes.length) {
    if (!criteria.title_includes.some((t) => title.includes(String(t).toLowerCase()))) return false;
  }
  if (criteria.remote && !/remote|anywhere/i.test(`${job.title} ${job.location || ''}`)) {
    if (job.remote === false) return false;
  }
  if (criteria.salary_min && job.salaryMin && job.salaryMin < criteria.salary_min) return false;
  if (criteria.exclude_industries && job.industries) {
    if (job.industries.some((i) => criteria.exclude_industries.includes(i))) return false;
  }
  if (criteria.keywords && criteria.keywords.length) {
    const hay = `${job.title || ''} ${job.jdText || ''} ${job.company || ''}`.toLowerCase();
    if (!criteria.keywords.some((k) => hay.includes(String(k).toLowerCase()))) return false;
  }
  if (criteria.maxAgeDays && job.postedAt) {
    const age = (Date.now() - Date.parse(job.postedAt)) / 86400000;
    if (Number.isFinite(age) && age > Number(criteria.maxAgeDays)) return false;
  }
  return true;
}

function filterBoards(boards, criteria) {
  let list = mergeBoards(boards);
  if (criteria && criteria.company) {
    const needle = String(criteria.company).toLowerCase();
    list = list.filter((b) => String(b.company || b.slug).toLowerCase().includes(needle));
  }
  if (criteria && Array.isArray(criteria.sites) && criteria.sites.length) {
    const sites = new Set(criteria.sites.map((s) => String(s).toLowerCase()));
    list = list.filter((b) => sites.has(String(b.ats || '').toLowerCase()));
  }
  return list;
}

async function fetchJson(fetchFn, url) {
  const res = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!res || !res.ok) throw new Error(`${url} ${res && res.status}`);
  return res.json();
}

function normalizeGreenhouse(job, company, slug) {
  const posting = job.absolute_url;
  return {
    company: company || slug,
    title: job.title,
    url: posting,
    posting,
    salary: '',
    location: job.location && job.location.name,
    remote: /remote/i.test((job.location && job.location.name) || ''),
    jdText: stripHtml(job.content || job.description || ''),
    jdSource: 'greenhouse-json',
  };
}

function normalizeLever(job, company, slug) {
  const loc = (job.categories && job.categories.location) || '';
  const posting = job.hostedUrl || job.applyUrl;
  return {
    company: company || slug,
    title: job.text,
    url: job.applyUrl || job.hostedUrl,
    posting,
    salary: '',
    location: loc,
    remote: /remote/i.test(job.workplaceType || loc),
    jdText: job.descriptionPlain || stripHtml(job.description || ''),
    jdSource: 'lever-json',
  };
}

function normalizeAshby(job, company, slug) {
  const posting = job.jobUrl || job.applyUrl;
  return {
    company: company || slug,
    title: job.title,
    url: job.applyUrl || job.jobUrl,
    posting,
    salary: job.compensationTierSummary || '',
    location: job.location,
    remote: Boolean(job.isRemote),
    jdText: job.descriptionPlain || stripHtml(job.descriptionHtml || ''),
    jdSource: 'ashby-json',
  };
}

async function fetchBoard(board, fetchFn) {
  const { ats, slug } = board;
  const company = board.company || slug;
  if (ats === 'greenhouse') {
    const data = await fetchJson(
      fetchFn,
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`
    );
    return (data.jobs || []).map((j) => normalizeGreenhouse(j, company, slug));
  }
  if (ats === 'lever') {
    const data = await fetchJson(fetchFn, `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
    return (Array.isArray(data) ? data : []).map((j) => normalizeLever(j, company, slug));
  }
  if (ats === 'ashby') {
    const data = await fetchJson(
      fetchFn,
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`
    );
    return (data.jobs || []).map((j) => normalizeAshby(j, company, slug));
  }
  if (ats === 'workable') {
    const data = await fetchJson(fetchFn, `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`);
    return (data.jobs || []).map((j) => ({
      company,
      title: j.title,
      url: j.url || j.application_url,
      posting: j.url || j.shortlink,
      salary: '',
      location: j.locations && j.locations[0],
      remote: /remote/i.test(JSON.stringify(j.locations || [])),
      jdText: stripHtml(j.description || ''),
      jdSource: 'workable-json',
    }));
  }
  if (ats === 'recruitee') {
    const data = await fetchJson(fetchFn, `https://${encodeURIComponent(slug)}.recruitee.com/api/offers`);
    const offers = data.offers || data;
    return (Array.isArray(offers) ? offers : []).map((j) => ({
      company,
      title: j.title,
      url: j.careers_url || j.apply_url,
      posting: j.careers_url || j.apply_url,
      salary: '',
      location: j.location || (j.locations && j.locations[0] && j.locations[0].city),
      remote: Boolean(j.remote),
      jdText: stripHtml(j.description || ''),
      jdSource: 'recruitee-json',
    }));
  }
  if (ats === 'smartrecruiters') {
    const data = await fetchJson(
      fetchFn,
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings`
    );
    const arr = data.content || data;
    return (Array.isArray(arr) ? arr : []).map((j) => ({
      company,
      title: j.name || j.title,
      url: j.ref || j.applyUrl,
      posting: j.ref || j.applyUrl,
      salary: '',
      location: j.location && j.location.city,
      remote: Boolean(j.location && j.location.remote),
      jdText: '',
      jdSource: 'smartrecruiters-json',
    }));
  }
  return [];
}

async function mapPool(items, limit, worker) {
  const out = [];
  let i = 0;
  async function next() {
    const idx = i;
    i += 1;
    if (idx >= items.length) return;
    try {
      out[idx] = await worker(items[idx], idx);
    } catch (err) {
      out[idx] = err;
    }
    await next();
  }
  const n = Math.max(1, Math.min(limit || 4, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => next()));
  return out;
}

async function findJobs(boards, criteria, n, fetchFn, opts = {}) {
  const capN = Number(n);
  if (!Number.isFinite(capN) || capN < 1) return { ok: false, missingCount: true, jobs: [] };
  const all = filterBoards(boards, criteria);
  if (!all.length) return { ok: false, needBoards: true, jobs: [] };
  const existing = opts.existingJobs || [];
  const list = boardsToFetch(all, existing, boardFromUrl);
  if (!list.length) return { ok: true, jobs: [], companyHeld: all.length };
  if (typeof fetchFn !== 'function') return { ok: false, error: 'no fetch', jobs: [] };
  const cap = Math.min(list.length, 80);
  const slice = list.slice(0, cap);
  const collected = [];
  const batches = await mapPool(slice, 4, async (board) => {
    try {
      return await fetchBoard(board, fetchFn);
    } catch (_) {
      return [];
    }
  });
  for (const rows of batches) {
    if (Array.isArray(rows)) collected.push(...rows);
  }
  const filtered = pickOnePerCompany(
    collected.filter((j) => j && j.url).filter((j) => matchesCriteria(j, criteria)),
    existing,
    boardFromUrl
  );
  return { ok: true, jobs: filtered.slice(0, capN) };
}

async function huntJobs({ boards, extraJobs, schema, fetch: fetchFn } = {}) {
  const plan = normalizeSchema(schema);
  if (plan.n == null) return { ok: false, missingCount: true, jobs: [] };
  const merged = mergeBoards([...(boards || []), ...boardsFromJobs(extraJobs || [])]);
  if (!merged.length) return { ok: false, needBoards: true, jobs: [] };
  return findJobs(merged, toDiscoverCriteria(plan), plan.n, fetchFn, {
    existingJobs: extraJobs || [],
  });
}

module.exports = {
  boardFromUrl,
  boardsFromJobs,
  mergeBoards,
  shapeBoard,
  upsertBoardList,
  matchesCriteria,
  filterBoards,
  fetchBoard,
  findJobs,
  huntJobs,
};
