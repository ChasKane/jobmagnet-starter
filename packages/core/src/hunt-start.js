const { normalizeSchema } = require('./search-schema');

function queryFromSchema(schema) {
  const s = normalizeSchema(schema);
  const parts = [];
  if (s.company) parts.push(s.company);
  for (const t of s.titleIncludes || []) parts.push(t);
  for (const k of s.keywords || []) parts.push(k);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const key = String(p || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(p).trim());
    if (out.length >= 8) break;
  }
  return out.join(' ') || 'software engineer';
}

function linkedinSearchUrl(schema) {
  const s = normalizeSchema(schema);
  const q = encodeURIComponent(queryFromSchema(s));
  let url = `https://www.linkedin.com/jobs/search/?keywords=${q}&location=United%20States`;
  if (s.remote === true) url += '&f_WT=2';
  if (s.maxAgeDays && s.maxAgeDays <= 7) url += '&f_TPR=r604800';
  else if (s.maxAgeDays && s.maxAgeDays <= 30) url += '&f_TPR=r2592000';
  return url;
}

const JSON_BOARD_SITES = new Set(['greenhouse', 'ashby', 'lever', 'workable', 'recruitee', 'smartrecruiters']);

function roleKind(schema) {
  const q = queryFromSchema(schema).toLowerCase();
  const front = /front/.test(q);
  const full = /full/.test(q);
  if (front && full) return 'dev';
  if (front) return 'front';
  if (full) return 'full';
  return 'dev';
}

function weWorkRemotelyUrl(schema) {
  const kind = roleKind(schema);
  if (kind === 'front') return 'https://weworkremotely.com/categories/remote-front-end-programming-jobs';
  if (kind === 'full') return 'https://weworkremotely.com/categories/remote-full-stack-programming-jobs';
  return 'https://weworkremotely.com/categories/remote-programming-jobs';
}

function remoteOkUrl(schema) {
  const kind = roleKind(schema);
  if (kind === 'front') return 'https://remoteok.com/remote-front-end-jobs';
  if (kind === 'full') return 'https://remoteok.com/remote-full-stack-jobs';
  return 'https://remoteok.com/remote-dev-jobs';
}

function himalayasUrl(schema) {
  const kind = roleKind(schema);
  if (kind === 'front') return 'https://himalayas.app/jobs/front-end-developer';
  if (kind === 'full') return 'https://himalayas.app/jobs/full-stack-developer';
  return 'https://himalayas.app/jobs/software-engineer';
}

function workingNomadsUrl(schema) {
  const kind = roleKind(schema);
  if (kind === 'front') return 'https://www.workingnomads.com/remote-front-end-jobs';
  if (kind === 'full') return 'https://www.workingnomads.com/remote-full-stack-jobs';
  return 'https://www.workingnomads.com/remote-development-jobs';
}

function justRemoteUrl(schema) {
  const kind = roleKind(schema);
  if (kind === 'front') return 'https://justremote.co/remote-frontend-developer-jobs';
  if (kind === 'full') return 'https://justremote.co/remote-full-stack-developer-jobs';
  return 'https://justremote.co/remote-developer-jobs';
}

function dynamiteJobsUrl(schema) {
  const kind = roleKind(schema);
  if (kind === 'front') return 'https://dynamitejobs.com/remote-frontend-developer-jobs';
  return 'https://dynamitejobs.com/remote-jobs/development';
}

function realWorkFromAnywhereUrl(schema) {
  const kind = roleKind(schema);
  if (kind === 'front') return 'https://www.realworkfromanywhere.com/remote-frontend-jobs';
  if (kind === 'full') return 'https://www.realworkfromanywhere.com/remote-fullstack-jobs';
  return 'https://www.realworkfromanywhere.com/remote-software-developer-jobs';
}

const WEBVIEW_FOR = {
  linkedin: (schema) => linkedinSearchUrl(schema),
  ycombinator: () => 'https://www.workatastartup.com/jobs',
  workatastartup: () => 'https://www.workatastartup.com/jobs',
  wellfound: (schema) =>
    `https://wellfound.com/jobs?q=${encodeURIComponent(queryFromSchema(schema))}`,
  weworkremotely: (schema) => weWorkRemotelyUrl(schema),
  remoteok: (schema) => remoteOkUrl(schema),
  himalayas: (schema) => himalayasUrl(schema),
  remotive: () => 'https://remotive.com/remote-jobs/software-development',
  jobicy: () => 'https://jobicy.com/remote-jobs/software-development',
  workingnomads: (schema) => workingNomadsUrl(schema),
  justremote: (schema) => justRemoteUrl(schema),
  dynamitejobs: (schema) => dynamiteJobsUrl(schema),
  nodesk: () => 'https://nodesk.co/remote-jobs/engineering/',
  '4dayweek': () => 'https://4dayweek.io/remote-engineering-jobs',
  remoters: () => 'https://remoters.net/jobs/software-development/',
  realworkfromanywhere: (schema) => realWorkFromAnywhereUrl(schema),
  remotecurrent: () => 'https://remotecurrent.rook.works/',
};

function boardsForSite(boards, site) {
  const key = String(site || '').toLowerCase();
  return (boards || []).filter((b) => String((b && b.ats) || '').toLowerCase() === key);
}

function huntStartUrls(schema, opts = {}) {
  const s = normalizeSchema(schema);
  const boards = opts.boards || [];
  const seen = new Set();
  const out = [];
  const sites = s.sites && s.sites.length ? s.sites : ['linkedin'];
  for (const raw of sites) {
    const site = String(raw || '').toLowerCase();
    if (JSON_BOARD_SITES.has(site) && boardsForSite(boards, site).length) continue;
    const build = WEBVIEW_FOR[site];
    if (!build) continue;
    const url = build(s);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ site, url });
  }
  if (!out.length) out.push({ site: 'linkedin', url: linkedinSearchUrl(s) });
  return out;
}

function describeHuntPlan(schema, boards = []) {
  const s = normalizeSchema(schema);
  if (s.n == null) return 'Search plan is missing a count.';
  const starts = huntStartUrls(s, { boards });
  const parts = [`Search plan for ${s.n} jobs.`];
  if (starts.length) {
    parts.push(`New listings come from the browser: ${starts.map((r) => `${r.site} ${r.url}`).join('; ')}.`);
  }
  const known = [];
  for (const site of s.sites || []) {
    const key = String(site || '').toLowerCase();
    if (!JSON_BOARD_SITES.has(key)) continue;
    const n = boardsForSite(boards, key).length;
    if (n) known.push(`${key} (${n})`);
  }
  if (known.length) {
    parts.push(
      `Known ${known.join(', ')} company pages are rechecked only when that company is not already on the list.`
    );
  }
  parts.push('Read it, then hit Go — Magnet hunts logged-in until it has enough new matches.');
  return parts.join(' ');
}

module.exports = {
  queryFromSchema,
  linkedinSearchUrl,
  huntStartUrls,
  describeHuntPlan,
  JSON_BOARD_SITES,
};
