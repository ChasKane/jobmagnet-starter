/** Compile a JobMagnet ingest search program from chat. n comes from the request. */

const MAX_N = 200;
const DEFAULT_SITES = [
  'linkedin',
  'greenhouse',
  'ashby',
  'lever',
  'workable',
  'recruitee',
  'smartrecruiters',
  'ycombinator',
  'weworkremotely',
  'remoteok',
  'himalayas',
  'remotive',
  'jobicy',
  'workingnomads',
  'justremote',
  'dynamitejobs',
  'nodesk',
  '4dayweek',
  'remoters',
  'realworkfromanywhere',
  'remotecurrent',
];

const SITE_ALIASES = [
  { id: 'linkedin', re: /\blinkedin\b/i },
  { id: 'greenhouse', re: /\bgreenhouse\b/i },
  { id: 'ashby', re: /\bashby\b/i },
  { id: 'lever', re: /\blever\b/i },
  { id: 'workable', re: /\bworkable\b/i },
  { id: 'recruitee', re: /\brecruitee\b/i },
  { id: 'smartrecruiters', re: /\bsmartrecruiters\b/i },
  { id: 'ycombinator', re: /\b(ycombinator|workatastartup|\byc\b)\b/i },
  { id: 'wellfound', re: /\b(wellfound|angellist)\b/i },
  { id: 'weworkremotely', re: /\b(we work remotely|weworkremotely)\b/i },
  { id: 'remoteok', re: /\b(remote\s?ok|remoteok)\b/i },
  { id: 'himalayas', re: /\bhimalayas\b/i },
  { id: 'remotive', re: /\bremotive\b/i },
  { id: 'jobicy', re: /\bjobicy\b/i },
  { id: 'workingnomads', re: /\b(working nomads|workingnomads)\b/i },
  { id: 'justremote', re: /\b(justremote|just remote)\b/i },
  { id: 'dynamitejobs', re: /\b(dynamite jobs|dynamitejobs)\b/i },
  { id: 'nodesk', re: /\bnodesk\b/i },
  { id: '4dayweek', re: /\b(4\s*day\s*week|4dayweek)\b/i },
  { id: 'remoters', re: /\bremoters\b/i },
  { id: 'realworkfromanywhere', re: /\b(real work from anywhere|realworkfromanywhere)\b/i },
  { id: 'remotecurrent', re: /\b(remote current|remotecurrent)\b/i },
];

function uniq(list) {
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    const v = String(item || '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function asInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  if (min != null && i < min) return min;
  if (max != null && i > max) return max;
  return i;
}

function asBool(value, fallback = null) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function asCount(value, fallback = null) {
  if (value == null || value === '') return fallback;
  return asInt(value, fallback, 1, MAX_N);
}

function emptySchema() {
  return {
    n: null,
    sites: DEFAULT_SITES.slice(),
    maxAgeDays: null,
    keywords: [],
    titleIncludes: [],
    salaryMin: null,
    remote: null,
    excludeIndustries: [],
    company: null,
  };
}

function normalizeSchema(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const sites = uniq(src.sites && src.sites.length ? src.sites : DEFAULT_SITES).map((s) => s.toLowerCase());
  return {
    n: asCount(src.n, null),
    sites: sites.length ? sites : DEFAULT_SITES.slice(),
    maxAgeDays: src.maxAgeDays == null || src.maxAgeDays === '' ? null : asInt(src.maxAgeDays, null, 1, 365),
    keywords: uniq(src.keywords),
    titleIncludes: uniq(src.titleIncludes || src.title_includes),
    salaryMin:
      src.salaryMin == null && src.salary_min == null
        ? null
        : asInt(src.salaryMin != null ? src.salaryMin : src.salary_min, null, 0, 10000000),
    remote: asBool(src.remote, null),
    excludeIndustries: uniq(src.excludeIndustries || src.exclude_industries),
    company: src.company ? String(src.company).trim() : null,
  };
}

function mergeSchema(base, patch) {
  const a = normalizeSchema(base);
  const b = patch && typeof patch === 'object' ? patch : {};
  const next = { ...a };
  if (b.n != null && b.n !== '') next.n = asCount(b.n, a.n);
  if (Array.isArray(b.sites) && b.sites.length) next.sites = uniq(b.sites).map((s) => s.toLowerCase());
  if (b.maxAgeDays != null && b.maxAgeDays !== '') next.maxAgeDays = asInt(b.maxAgeDays, a.maxAgeDays, 1, 365);
  if (Array.isArray(b.keywords) && b.keywords.length) next.keywords = uniq(a.keywords.concat(b.keywords));
  const titles = b.titleIncludes || b.title_includes;
  if (Array.isArray(titles) && titles.length) next.titleIncludes = uniq(a.titleIncludes.concat(titles));
  if (b.salaryMin != null || b.salary_min != null) {
    next.salaryMin = asInt(b.salaryMin != null ? b.salaryMin : b.salary_min, a.salaryMin, 0, 10000000);
  }
  if (b.remote != null) next.remote = asBool(b.remote, a.remote);
  const excl = b.excludeIndustries || b.exclude_industries;
  if (Array.isArray(excl) && excl.length) next.excludeIndustries = uniq(a.excludeIndustries.concat(excl));
  if (b.company) next.company = String(b.company).trim();
  return normalizeSchema(next);
}

function looksLikeSearch(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/https?:\/\//i.test(t) && !/^(find|search)\b/i.test(t)) return false;
  return (
    /^(find|search|look for|hunt|scrape)\b/i.test(t) ||
    /\b(jobs?|roles?|listings?|openings?)\b/i.test(t) ||
    /\b(remote|hybrid|on[- ]?site|frontend|front-end|\bfe\b|full[- ]?stack|\d+\s*k)\b/i.test(t)
  );
}

function looksLikeApprove(text) {
  const t = String(text || '')
    .trim()
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ');
  if (/^(approve|go|run it|looks good|ship it|do it|search|execute|execute that plan|execute the plan|execute this plan)$/i.test(t)) {
    return true;
  }
  if (/^go\b/i.test(t) && /\b(execute|run|search|approve|plan)\b/i.test(t)) return true;
  if (/^execute\b/i.test(t) && /\bplan\b/i.test(t)) return true;
  return false;
}

function compileSearchSchema(text, prior) {
  const next = normalizeSchema(prior);
  const t = String(text || '').trim();
  if (!t) return next;

  const nMatch =
    t.match(/\b(?:find|get|add|grab)\s+(\d+)\b/i) ||
    t.match(/\b(\d+)\s+(?:jobs?|roles?|listings?|openings?)\b/i);
  if (nMatch) next.n = asCount(nMatch[1], next.n);

  const salary = t.match(/(\d+)\s*k\+?/i);
  if (salary) next.salaryMin = asInt(Number(salary[1]) * 1000, next.salaryMin, 0, 10000000);

  if (/\bremote\b/i.test(t)) next.remote = true;
  if (/\b(on[- ]?site|hybrid|in[- ]?office)\b/i.test(t) && !/\bremote\b/i.test(t)) next.remote = false;

  if (/front\s*-?end|frontend|\bfe\b/i.test(t)) {
    next.titleIncludes = uniq(next.titleIncludes.concat(['frontend', 'front end', 'react']));
  }
  if (/full\s*-?stack|fullstack/i.test(t)) {
    next.titleIncludes = uniq(next.titleIncludes.concat(['full stack', 'fullstack']));
  }
  if (/\b(staff|principal|senior|staff\+?)\b/i.test(t)) {
    const level = (t.match(/\b(principal|staff|senior)\b/i) || [])[1];
    if (level) next.titleIncludes = uniq(next.titleIncludes.concat([level.toLowerCase()]));
  }

  const days = t.match(/(?:last|past|within|newer than)\s+(\d+)\s+days?/i);
  if (days) next.maxAgeDays = asInt(days[1], next.maxAgeDays, 1, 365);

  if (/no military|exclude military/i.test(t)) {
    next.excludeIndustries = uniq(next.excludeIndustries.concat(['military']));
  }

  const atCo = t.match(/\bat\s+([A-Za-z0-9.&' -]{2,40})/);
  if (atCo && !/^(least|least\s+\d)/i.test(atCo[1])) next.company = atCo[1].trim();

  const sitesHit = SITE_ALIASES.filter((s) => s.re.test(t)).map((s) => s.id);
  if (sitesHit.length) next.sites = uniq(sitesHit);

  const extra = t
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(find|search|look for|hunt|remote|hybrid|jobs?|roles?|listings?|openings?|frontend|front-end|\bfe\b|full[- ]?stack|staff|senior|principal)\b/gi, ' ')
    .replace(/\b\d+\s*k\+?\b/gi, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/[^\w.+# -]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2);
  if (extra.length) next.keywords = uniq(next.keywords.concat(extra.slice(0, 12)));

  return normalizeSchema(next);
}

function schemaReady(schema) {
  const s = normalizeSchema(schema);
  return Boolean(
    s.n != null &&
      ((s.titleIncludes && s.titleIncludes.length) ||
        (s.keywords && s.keywords.length) ||
        s.salaryMin ||
        s.remote != null ||
        s.company ||
        s.maxAgeDays)
  );
}

function toDiscoverCriteria(schema) {
  const s = normalizeSchema(schema);
  return {
    title_includes: s.titleIncludes,
    remote: s.remote,
    salary_min: s.salaryMin,
    exclude_industries: s.excludeIndustries,
    company: s.company,
    keywords: s.keywords,
    sites: s.sites,
    maxAgeDays: s.maxAgeDays,
  };
}

function fromToolArgs(args) {
  return normalizeSchema(args || {});
}

function planLines(schema) {
  const s = normalizeSchema(schema);
  return [
    { label: 'Jobs', value: s.n == null ? '—' : String(s.n) },
    { label: 'Sites', value: s.sites.join(', ') },
    { label: 'Max age', value: s.maxAgeDays ? `${s.maxAgeDays} days` : 'any' },
    { label: 'Titles', value: s.titleIncludes.join(', ') || '—' },
    { label: 'Keywords', value: s.keywords.join(', ') || '—' },
    { label: 'Pay', value: s.salaryMin ? `${Math.round(s.salaryMin / 1000)}k+` : '—' },
    { label: 'Remote', value: s.remote === true ? 'yes' : s.remote === false ? 'no' : 'any' },
    { label: 'Company', value: s.company || 'any' },
    { label: 'Exclude', value: s.excludeIndustries.join(', ') || '—' },
  ];
}

function formatPlanReply(schema, boards) {
  try {
    return require('./hunt-start').describeHuntPlan(schema, boards);
  } catch (_) {
    const s = normalizeSchema(schema);
    if (s.n == null) return 'Search plan is missing a count.';
    return `Search plan for ${s.n} jobs on ${s.sites.join(', ')}. Read it, then hit Go — Magnet hunts logged-in until it has enough new matches.`;
  }
}

module.exports = {
  MAX_N,
  DEFAULT_SITES,
  SITE_ALIASES,
  emptySchema,
  normalizeSchema,
  mergeSchema,
  looksLikeSearch,
  looksLikeApprove,
  compileSearchSchema,
  schemaReady,
  toDiscoverCriteria,
  fromToolArgs,
  planLines,
  formatPlanReply,
};
