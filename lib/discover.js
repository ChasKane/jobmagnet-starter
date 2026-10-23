const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { statusOf, getRecord, writeRecord } = require('./process-store');
const { canonicalUrl, duplicateOf, indexJobs, postingKey } = require('./job-identity');
const { appendListedJobs } = require('./ai-submissions');
const { listLiveJobs } = require('./live-jobs');
const { fetchJdForUrl, jdFromBoardText, mapPool, stripHtml } = require('./jd-ingest');
const { shouldReplaceJd, isSummarizedJd, fillApplyCue, hasApplyCue } = require('./jd');
const { boardFromUrl: boardOfUrl } = require('../packages/core/src/boards');
const {
  heldSet,
  isHeld,
  holdKeys,
  pickOnePerCompany,
  boardsToFetch,
} = require('../packages/core/src/company-hold');

const KNOWLEDGE = path.join(__dirname, '..', 'knowledge');
const JOBS_FILE = path.join(KNOWLEDGE, 'jobs.yaml');
const BOARDS_FILE = path.join(KNOWLEDGE, 'boards.yaml');
const TAGS_FILE = path.join(KNOWLEDGE, 'tag-rules.yaml');

function loadYaml(file, fallback) {
  try {
    return yaml.load(fs.readFileSync(file, 'utf8')) || fallback;
  } catch {
    return fallback;
  }
}

function saveYaml(file, doc) {
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100, noRefs: true, sortingKeys: false }));
}

function extractUrls(text) {
  return [...String(text || '').matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) =>
    m[0].replace(/[),.;]+$/, '')
  );
}

function classifyUrl(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  const ats =
    /ashbyhq\.com$/.test(host) ||
    /greenhouse\.io$/.test(host) ||
    /lever\.co$/.test(host) ||
    /smartrecruiters\.com$/.test(host) ||
    /workable\.com$/.test(host) ||
    /recruitee\.com$/.test(host);
  const linkedin = /linkedin\.com$/.test(host) && /\/jobs\/view/i.test(u.pathname);
  return { href, host, ats, linkedin };
}

function boardFromUrl(href) {
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    if (/ashbyhq\.com$/.test(host) && parts[0]) {
      return { ats: 'ashby', slug: parts[0], source_url: href };
    }
    if (/greenhouse\.io$/.test(host) && parts[0]) {
      return { ats: 'greenhouse', slug: parts[0], source_url: href };
    }
    if (/lever\.co$/.test(host) && parts[0]) {
      return { ats: 'lever', slug: parts[0], source_url: href };
    }
    if (/smartrecruiters\.com$/.test(host) && parts[0]) {
      return { ats: 'smartrecruiters', slug: parts[0], source_url: href };
    }
  } catch (_) {}
  return null;
}

function upsertBoard(partial, company) {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().upsertBoard(partial, company);
  }
  const doc = loadYaml(BOARDS_FILE, { version: 1, boards: [] });
  if (!Array.isArray(doc.boards)) doc.boards = [];
  const hit = doc.boards.find((b) => b.ats === partial.ats && b.slug === partial.slug);
  if (hit) {
    if (company && !hit.company) hit.company = company;
    saveYaml(BOARDS_FILE, doc);
    return hit;
  }
  const row = { company: company || partial.slug, ...partial };
  doc.boards.push(row);
  saveYaml(BOARDS_FILE, doc);
  return row;
}

function tagText(title, description, company) {
  let rules = { industries: {}, skills: {} };
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    rules = persist.nodeStore().listTagRules();
  } else rules = loadYaml(TAGS_FILE, { industries: {}, skills: {} });
  const blob = `${title} ${description} ${company}`.toLowerCase();
  const industries = [];
  const skills = [];
  for (const [name, needles] of Object.entries(rules.industries || {})) {
    if ((needles || []).some((n) => blob.includes(String(n).toLowerCase()))) industries.push(name);
  }
  for (const [name, needles] of Object.entries(rules.skills || {})) {
    if ((needles || []).some((n) => blob.includes(String(n).toLowerCase()))) skills.push(name);
  }
  return { industries, skills };
}

function jobsApi() {
  const persist = require('../packages/persist');
  persist.open();
  return persist.nodeStore();
}

function packPersistJd(row) {
  const packed = row.jd && row.jd.text ? row.jd : null;
  const text = (packed && packed.text) || row.jdText || '';
  if (!text || text.length < 80) return null;
  if (isSummarizedJd(text) && /^(hunt|search)$/i.test(String((packed && packed.source) || row.jdSource || ''))) {
    return null;
  }
  const rec = getRecord(row.url);
  if (rec.jd && rec.jd.text && !shouldReplaceJd(rec.jd, text)) {
    const incoming = packed && hasApplyCue(packed) ? packed : row;
    if (!hasApplyCue(rec.jd) && hasApplyCue(incoming)) {
      return {
        rec,
        jd: {
          ...rec.jd,
          apply_surface: incoming.apply_surface,
          ...(incoming.apply_cta ? { apply_cta: incoming.apply_cta } : {}),
        },
        mergeCue: true,
      };
    }
    return null;
  }
  const cue = packed
    ? {
        apply_surface: packed.apply_surface || row.apply_surface || '',
        apply_cta: packed.apply_cta || row.apply_cta || null,
      }
    : {
        apply_surface: row.apply_surface || '',
        apply_cta: row.apply_cta || null,
      };
  const jd = packed && packed.findings
    ? {
        text: packed.text,
        source: packed.source || row.jdSource || 'ingest',
        captured_at: packed.captured_at || new Date().toISOString(),
        findings: packed.findings,
        ...(cue.apply_surface ? { apply_surface: cue.apply_surface } : {}),
        ...(cue.apply_cta ? { apply_cta: cue.apply_cta } : {}),
      }
    : jdFromBoardText(text, { source: row.jdSource || 'ingest', posting: row.posting });
  if (!jd) return null;
  if (!jd.apply_surface && cue.apply_surface) jd.apply_surface = cue.apply_surface;
  if (!jd.apply_cta && cue.apply_cta) jd.apply_cta = cue.apply_cta;
  return { rec, jd };
}

async function persistJd(row, opts = {}) {
  const packed = packPersistJd(row);
  if (!packed) return false;
  let { rec, jd } = packed;
  if (!hasApplyCue(jd)) {
    jd = await fillApplyCue(jd, {
      judge: opts.judge,
      meta: { href: row.url, title: row.title || (row.jd && row.jd.title) || '', ctas: opts.ctas || [] },
      forceJudge: Boolean(opts.judge),
    });
  }
  writeRecord(row.url, {
    jd,
    posting: row.posting || rec.posting || '',
  });
  return true;
}

async function enrichRow(row) {
  if (row.jdText && String(row.jdText).length >= 80 && !isSummarizedJd(row.jdText)) {
    return {
      ...row,
      posting: row.posting || row.linkedin || row.url,
      jdSource: row.jdSource || 'ats-json',
    };
  }
  const hit = await fetchJdForUrl(row.posting || row.url, row.linkedin);
  if (!hit) {
    return { ...row, posting: row.posting || row.linkedin || row.url };
  }
  const tags = tagText(hit.title || row.title, hit.text, hit.company || row.company);
  return {
    ...row,
    title: row.title && row.title !== 'paste' ? row.title : hit.title || row.title,
    company: row.title === 'paste' || !row.company ? hit.company || row.company : row.company,
    salary: row.salary || hit.salary || '',
    posting: hit.posting || row.posting || row.linkedin || row.url,
    url: hit.applyUrl || row.url,
    industries: (row.industries && row.industries.length ? row.industries : tags.industries),
    skills: (row.skills && row.skills.length ? row.skills : tags.skills),
    jdText: hit.text,
    jdSource: hit.source,
    jd: hit,
  };
}

async function appendJobs(rows) {
  const api = jobsApi();
  const identity = indexJobs(listLiveJobs());
  const held = heldSet(listLiveJobs(), boardOfUrl);
  const rememberIdentity = (row) => {
    for (const key of [canonicalUrl(row.url), canonicalUrl(row.linkedin), canonicalUrl(row.posting)]) {
      if (key) identity.byCanon.set(key, row);
    }
    const key = postingKey(row);
    if (key && !identity.byPosting.has(key)) identity.byPosting.set(key, row);
  };
  let added = 0;
  let dupes = 0;
  let companyHeld = 0;
  let jds = 0;
  const addedUrls = [];
  const addedRows = [];
  const pending = [];
  const skipCompany = (row) => isHeld(row, held, boardOfUrl);
  const remember = (row) => {
    for (const key of holdKeys(row, boardOfUrl)) held.add(key);
  };
  for (const row of rows || []) {
    if (!row || !row.url) continue;
    if (api.hasJobUrl(row.url, row.linkedin, row.posting) || duplicateOf(row, identity)) {
      dupes += 1;
      continue;
    }
    const st = statusOf(row.url);
    if (st && st !== 'open') {
      dupes += 1;
      continue;
    }
    if (skipCompany(row)) {
      companyHeld += 1;
      continue;
    }
    pending.push(row);
  }
  const enriched = await mapPool(pending, 4, enrichRow);
  for (const row of enriched) {
    if (!row.url) continue;
    if (api.hasJobUrl(row.url, row.linkedin, row.posting) || duplicateOf(row, identity)) {
      dupes += 1;
      continue;
    }
    if (skipCompany(row)) {
      companyHeld += 1;
      continue;
    }
    const stored = {
      company: row.company,
      title: row.title,
      url: row.url,
      linkedin: row.linkedin || '',
      posting: row.posting || row.linkedin || '',
      salary: row.salary || '',
      location: row.location ? String(row.location) : '',
      yoe: row.yoe || '',
      level: row.level || '',
      industries: row.industries || [],
      skills: row.skills || [],
    };
    api.upsertJob(stored);
    remember(stored);
    rememberIdentity(stored);
    added += 1;
    addedUrls.push(row.url);
    addedRows.push(stored);
    const b = boardFromUrl(row.url) || boardFromUrl(row.posting);
    if (b) upsertBoard(b, row.company);
    if (await persistJd({ ...row, url: stored.url })) jds += 1;
  }
  if (addedRows.length && !require('./store/mode').isSupabase()) {
    try {
      appendListedJobs(addedRows);
    } catch (err) {
      console.warn('[magnet] jobs.yaml:', err.message || err);
    }
  }
  return { added, dupes, companyHeld, jds, urls: addedUrls };
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

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function normalizeGreenhouse(job, slug) {
  const posting = job.absolute_url;
  return {
    company: slug,
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

function normalizeLever(job, slug) {
  const loc = (job.categories && job.categories.location) || '';
  const posting = job.hostedUrl || job.applyUrl;
  return {
    company: slug,
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

function normalizeAshby(job, slug) {
  const posting = job.jobUrl || job.applyUrl;
  return {
    company: slug,
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

async function fetchBoard(board) {
  const { ats, slug } = board;
  try {
    if (ats === 'greenhouse') {
      const data = await fetchJson(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`
      );
      return (data.jobs || []).map((j) => normalizeGreenhouse(j, board.company || slug));
    }
    if (ats === 'lever') {
      const data = await fetchJson(
        `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`
      );
      return (Array.isArray(data) ? data : []).map((j) => normalizeLever(j, board.company || slug));
    }
    if (ats === 'ashby') {
      const data = await fetchJson(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`
      );
      return (data.jobs || []).map((j) => normalizeAshby(j, board.company || slug));
    }
    if (ats === 'workable') {
      const data = await fetchJson(
        `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`
      );
      return (data.jobs || []).map((j) => ({
        company: board.company || slug,
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
      const data = await fetchJson(`https://${encodeURIComponent(slug)}.recruitee.com/api/offers`);
      const offers = data.offers || data;
      return (Array.isArray(offers) ? offers : []).map((j) => ({
        company: board.company || slug,
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
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings`
      );
      const arr = data.content || data;
      return (Array.isArray(arr) ? arr : []).map((j) => ({
        company: board.company || slug,
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
  } catch (err) {
    console.warn('[magnet] board', ats, slug, err.message || err);
  }
  return [];
}

async function findJobs(criteria, n = 10) {
  const boardsDoc = loadYaml(BOARDS_FILE, { boards: [] });
  let boards = boardsDoc.boards || [];
  if (criteria && criteria.company) {
    const needle = String(criteria.company).toLowerCase();
    boards = boards.filter((b) => String(b.company || b.slug).toLowerCase().includes(needle));
  }
  if (criteria && Array.isArray(criteria.sites) && criteria.sites.length) {
    const sites = new Set(criteria.sites.map((s) => String(s).toLowerCase()));
    boards = boards.filter((b) => sites.has(String(b.ats || '').toLowerCase()));
  }
  const existing = listLiveJobs();
  const beforeHold = boards.length;
  boards = boardsToFetch(boards, existing, boardOfUrl);
  if (!boards.length) {
    return beforeHold
      ? { ok: true, jobs: [], companyHeld: beforeHold }
      : { ok: false, needBoards: true, jobs: [] };
  }
  const collected = [];
  for (let i = 0; i < boards.length; i += 1) {
    const rows = await fetchBoard(boards[i]);
    collected.push(...rows);
    if (i + 1 >= n) break;
  }
  const tagged = collected.map((j) => {
    const tags = tagText(j.title, j.jdText || j.description, j.company);
    return {
      company: j.company,
      title: j.title,
      url: j.url,
      posting: j.posting || j.url,
      salary: j.salary || '',
      yoe: '',
      level: '',
      industries: tags.industries,
      skills: tags.skills,
      remote: j.remote,
      jdText: j.jdText || j.description || '',
      jdSource: j.jdSource || 'ats-json',
    };
  });
  const filtered = pickOnePerCompany(
    tagged.filter((j) => matchesCriteria(j, criteria)),
    existing,
    boardOfUrl
  );
  return { ok: true, jobs: filtered.slice(0, n) };
}

function seedBoardsFromJobs(jobs) {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    const api = persist.nodeStore();
    const have = new Set();
    for (const row of api.listBoards()) {
      if (row && row.ats && row.slug) have.add(`${row.ats}:${String(row.slug).toLowerCase()}`);
    }
    let added = 0;
    const list = Array.isArray(jobs) && jobs.length ? jobs : listLiveJobs();
    for (const j of list) {
      const b = boardFromUrl(j.url);
      if (!b) continue;
      const key = `${b.ats}:${String(b.slug).toLowerCase()}`;
      if (have.has(key)) continue;
      have.add(key);
      api.upsertBoard(b, j.company);
      added += 1;
    }
    return added;
  }
  const doc = loadYaml(BOARDS_FILE, { version: 1, boards: [] });
  if (!Array.isArray(doc.boards)) doc.boards = [];
  const list = Array.isArray(jobs) && jobs.length ? jobs : listLiveJobs();
  let added = 0;
  for (const j of list) {
    const b = boardFromUrl(j.url);
    if (!b) continue;
    if (doc.boards.find((x) => x.ats === b.ats && x.slug === b.slug)) continue;
    doc.boards.push({ company: j.company || b.slug, ...b });
    added += 1;
  }
  if (added) saveYaml(BOARDS_FILE, doc);
  return added;
}

async function addUrlsFromText(text) {
  const urls = extractUrls(text).map(classifyUrl).filter(Boolean);
  const rows = [];
  let pendingLi = null;
  for (const u of urls) {
    if (u.linkedin && !u.ats) {
      pendingLi = u.href;
      continue;
    }
    if (u.ats || !u.linkedin) {
      rows.push({
        company: u.host.split('.')[0],
        title: 'paste',
        url: u.href,
        linkedin: u.linkedin ? u.href : pendingLi || '',
        posting: u.ats ? u.href : pendingLi || u.href,
        industries: [],
        skills: [],
      });
      pendingLi = null;
    }
  }
  if (pendingLi && !rows.length) {
    rows.push({
      company: 'LinkedIn',
      title: 'paste',
      url: pendingLi,
      linkedin: pendingLi,
      posting: pendingLi,
    });
  }
  return appendJobs(rows);
}

function editList(edit) {
  const api = jobsApi();
  const remove = new Set((edit.remove_companies || []).map((c) => String(c).toLowerCase()));
  const skip = new Set(edit.add_exclude_industries || []);
  let removed = 0;
  for (const job of api.listJobs()) {
    const dropCompany = remove.size && remove.has(String(job.company || '').toLowerCase());
    const dropIndustry = skip.size && (job.industries || []).some((i) => skip.has(i));
    if (dropCompany || dropIndustry) {
      api.removeJob(job.id);
      removed += 1;
    }
  }
  return { removed };
}

module.exports = {
  extractUrls,
  addUrlsFromText,
  findJobs,
  editList,
  appendJobs,
  persistJd,
  upsertBoard,
  boardFromUrl,
  seedBoardsFromJobs,
  JOBS_FILE,
};
