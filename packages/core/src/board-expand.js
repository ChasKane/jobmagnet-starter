/** When every learned board is a company already listed, probe new public ATS boards. */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { boardFromUrl, fetchBoard, matchesCriteria, mergeBoards, huntJobs } = require('./boards');
const { heldSet, isHeld, pickOnePerCompany } = require('./company-hold');
const { normalizeSchema, toDiscoverCriteria } = require('./search-schema');

const PROBE_ATS = ['ashby', 'greenhouse', 'lever'];
const YC_HIRING = 'https://yc-oss.github.io/api/companies/hiring.json';
const MISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_BUDGET = 36;
const DEFAULT_BATCH = 6;
const DEFAULT_PROBES = path.join(__dirname, '..', '..', '..', 'knowledge', 'board-probes.yaml');

function slugKey(slug) {
  return String(slug || '').trim().toLowerCase();
}

function probeAtsFor(sites) {
  const want = new Set((sites && sites.length ? sites : PROBE_ATS).map((s) => String(s || '').toLowerCase()));
  return PROBE_ATS.filter((ats) => want.has(ats));
}

function knownSlugSet(boards) {
  const set = new Set();
  for (const board of mergeBoards(boards)) {
    const key = slugKey(board.slug);
    if (key) set.add(key);
  }
  return set;
}

function freshMiss(misses, slug, now) {
  const row = misses && misses[slugKey(slug)];
  if (!row || !row.at) return false;
  const at = Date.parse(row.at);
  if (!Number.isFinite(at)) return false;
  return now - at < MISS_TTL_MS;
}

function missingStatus(err) {
  const msg = String((err && err.message) || '');
  const hit = msg.match(/\s(\d{3})$/);
  const status = hit ? Number(hit[1]) : 0;
  return status === 404 || status === 410;
}

function sourceUrl(ats, slug) {
  if (ats === 'ashby') return `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`;
  if (ats === 'greenhouse') return `https://boards.greenhouse.io/${encodeURIComponent(slug)}`;
  if (ats === 'lever') return `https://jobs.lever.co/${encodeURIComponent(slug)}`;
  return '';
}

async function defaultCandidates(fetchFn) {
  const res = await fetchFn(YC_HIRING, { headers: { accept: 'application/json' } });
  if (!res || !res.ok) return [];
  const data = await res.json();
  const list = Array.isArray(data) ? data : (data && data.companies) || [];
  const out = [];
  for (const row of list) {
    const slug = String((row && row.slug) || '').trim();
    if (!slug) continue;
    out.push({ name: String((row && (row.name || row.slug)) || slug), slug });
  }
  return out;
}

async function probeCompany(candidate, atsList, fetchFn) {
  const slug = String(candidate.slug);
  const company = candidate.name || slug;
  let uncertain = false;
  for (const ats of atsList) {
    const board = { company, ats, slug, source_url: sourceUrl(ats, slug) };
    try {
      const jobs = await fetchBoard(board, fetchFn);
      if (Array.isArray(jobs)) return { live: true, missing: false, board, jobs };
    } catch (err) {
      if (!missingStatus(err)) uncertain = true;
    }
  }
  return { live: false, missing: !uncertain, board: null, jobs: [] };
}

async function expandBoards({
  boards = [],
  existingJobs = [],
  criteria = {},
  need = 1,
  fetch: fetchFn,
  candidates,
  misses = {},
  now = Date.now(),
  budget = DEFAULT_BUDGET,
  batchSize = DEFAULT_BATCH,
  sites,
} = {}) {
  const nextMisses = { ...(misses || {}) };
  if (!(Number(need) >= 1) || typeof fetchFn !== 'function') {
    return { jobs: [], addedBoards: [], misses: nextMisses, probed: 0 };
  }
  const atsList = probeAtsFor(sites || criteria.sites);
  if (!atsList.length) return { jobs: [], addedBoards: [], misses: nextMisses, probed: 0 };

  let pool = candidates;
  if (pool == null) {
    try {
      pool = await defaultCandidates(fetchFn);
    } catch {
      pool = [];
    }
  }

  const known = knownSlugSet(boards);
  const heldJobs = existingJobs || [];
  const held = heldSet(heldJobs, boardFromUrl);
  const eligible = [];
  const seen = new Set();
  for (const raw of pool || []) {
    const slug = String((raw && raw.slug) || '').trim();
    const key = slugKey(slug);
    if (!key || seen.has(key) || known.has(key) || freshMiss(nextMisses, slug, now)) continue;
    const name = String((raw && (raw.name || raw.slug)) || slug);
    if (held && isHeld({ company: name, slug, ats: atsList[0] }, held, boardFromUrl)) continue;
    seen.add(key);
    eligible.push({ name, slug });
    if (eligible.length >= budget) break;
  }

  const addedBoards = [];
  const collected = [];
  let probed = 0;
  const size = Math.max(1, Number(batchSize) || DEFAULT_BATCH);
  for (let i = 0; i < eligible.length; i += size) {
    const batch = eligible.slice(i, i + size);
    const results = await Promise.all(batch.map((candidate) => probeCompany(candidate, atsList, fetchFn)));
    probed += batch.length;
    for (let j = 0; j < batch.length; j += 1) {
      const candidate = batch[j];
      const hit = results[j];
      if (!hit.live) {
        if (hit.missing) {
          nextMisses[slugKey(candidate.slug)] = { at: new Date(now).toISOString(), slug: candidate.slug };
        }
        continue;
      }
      addedBoards.push(hit.board);
      known.add(slugKey(candidate.slug));
      for (const job of hit.jobs) {
        if (job && job.url && matchesCriteria(job, criteria)) collected.push(job);
      }
    }
    const picked = pickOnePerCompany(collected, heldJobs, boardFromUrl);
    if (picked.length >= need) {
      return { jobs: picked.slice(0, need), addedBoards, misses: nextMisses, probed };
    }
  }
  const picked = pickOnePerCompany(collected, heldJobs, boardFromUrl);
  return { jobs: picked.slice(0, need), addedBoards, misses: nextMisses, probed };
}

async function huntWithNewBoards({
  boards,
  extraJobs,
  schema,
  fetch: fetchFn,
  expand = false,
  candidates,
  misses,
  now,
  budget,
  batchSize,
} = {}) {
  const plan = normalizeSchema(schema);
  const found = await huntJobs({ boards, extraJobs, schema: plan, fetch: fetchFn });
  const baseMisses = misses || {};
  const base = { ...found, addedBoards: [], misses: baseMisses, probed: 0 };
  if (!expand || found.missingCount || plan.n == null || plan.company) return base;
  const need = plan.n - (found.jobs || []).length;
  if (need < 1) return base;
  let grown;
  try {
    grown = await expandBoards({
      boards,
      existingJobs: [...(extraJobs || []), ...(found.jobs || [])],
      criteria: toDiscoverCriteria(plan),
      need,
      fetch: fetchFn,
      candidates,
      misses: baseMisses,
      now,
      budget,
      batchSize,
      sites: plan.sites,
    });
  } catch {
    return base;
  }
  const jobs = [...(found.jobs || []), ...(grown.jobs || [])].slice(0, plan.n);
  const learned = (grown.addedBoards || []).length > 0;
  return {
    ok: Boolean(found.ok || jobs.length || learned),
    jobs,
    needBoards: Boolean(found.needBoards) && !jobs.length && !learned,
    companyHeld: found.companyHeld,
    addedBoards: grown.addedBoards || [],
    misses: grown.misses || baseMisses,
    probed: grown.probed || 0,
  };
}

function loadProbeMisses(file = DEFAULT_PROBES) {
  try {
    const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    return doc.misses && typeof doc.misses === 'object' && !Array.isArray(doc.misses) ? doc.misses : {};
  } catch {
    return {};
  }
}

function saveProbeMisses(misses, file = DEFAULT_PROBES, now = Date.now()) {
  const kept = {};
  for (const [key, row] of Object.entries(misses || {})) {
    const at = Date.parse(row && row.at);
    if (!Number.isFinite(at) || now - at >= MISS_TTL_MS) continue;
    kept[key] = { at: row.at, slug: (row && row.slug) || key };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = yaml.dump({ version: 1, misses: kept }, { lineWidth: 100, noRefs: true, sortingKeys: false });
  fs.writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
  return kept;
}

module.exports = {
  expandBoards,
  huntWithNewBoards,
  loadProbeMisses,
  saveProbeMisses,
  PROBE_ATS,
  YC_HIRING,
  MISS_TTL_MS,
};
