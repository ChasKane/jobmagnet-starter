/** One listing per company. Keys are a normalized name plus the ATS board. */

const SUFFIX = new Set(['inc', 'llc', 'ltd', 'corp', 'co', 'company', 'incorporated', 'limited', 'plc', 'gmbh']);

/** Host fragments paste uses before a JD fills the real employer. */
const PLACEHOLDER = new Set([
  'linkedin',
  'boards',
  'jobs',
  'jobboards',
  'paste',
  'apply',
  'www',
  'greenhouse',
  'ashby',
  'ashbyhq',
  'lever',
  'workable',
  'recruitee',
  'smartrecruiters',
]);

function companySlug(company) {
  if (!company) return '';
  const tokens = String(company)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  while (tokens.length > 1 && SUFFIX.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join('');
}

function addKey(keys, seen, key) {
  if (!key || seen.has(key)) return;
  seen.add(key);
  keys.push(key);
}

function addBoardKeys(keys, seen, board) {
  if (!board || !board.slug) return;
  const ats = String(board.ats || '').toLowerCase();
  const slug = String(board.slug).toLowerCase();
  if (ats && slug) addKey(keys, seen, `board:${ats}/${slug}`);
  const slugName = companySlug(board.slug);
  if (slugName && !PLACEHOLDER.has(slugName)) addKey(keys, seen, `name:${slugName}`);
  const co = companySlug(board.company);
  if (co && !PLACEHOLDER.has(co)) addKey(keys, seen, `name:${co}`);
}

function holdKeys(row, boardFromUrl) {
  const keys = [];
  const seen = new Set();
  const src = row && typeof row === 'object' ? row : {};
  const name = companySlug(src.company || src.name);
  if (name && !PLACEHOLDER.has(name)) addKey(keys, seen, `name:${name}`);
  if (typeof boardFromUrl === 'function') {
    for (const href of [src.url, src.posting, src.linkedin]) {
      if (!href) continue;
      addBoardKeys(keys, seen, boardFromUrl(href));
    }
  }
  if (src.ats && src.slug) addBoardKeys(keys, seen, src);
  return keys;
}

function heldSet(jobs, boardFromUrl) {
  const set = new Set();
  for (const job of jobs || []) {
    for (const key of holdKeys(job, boardFromUrl)) set.add(key);
  }
  return set;
}

function isHeld(row, set, boardFromUrl) {
  if (!set || !set.size) return false;
  const keys = holdKeys(row, boardFromUrl);
  if (!keys.length) return false;
  return keys.some((key) => set.has(key));
}

function rememberHold(set, row, boardFromUrl) {
  if (!set) return;
  for (const key of holdKeys(row, boardFromUrl)) set.add(key);
}

function pickOnePerCompany(jobs, existing, boardFromUrl) {
  const held = heldSet(existing, boardFromUrl);
  const out = [];
  for (const job of jobs || []) {
    if (isHeld(job, held, boardFromUrl)) continue;
    out.push(job);
    rememberHold(held, job, boardFromUrl);
  }
  return out;
}

function boardIsHeld(board, held, boardFromUrl) {
  if (!board || !held || !held.size) return false;
  return isHeld(
    {
      company: board.company,
      url: board.source_url,
      ats: board.ats,
      slug: board.slug,
    },
    held,
    boardFromUrl
  );
}

function boardsToFetch(boards, existing, boardFromUrl) {
  const held = heldSet(existing, boardFromUrl);
  const out = [];
  for (const board of boards || []) {
    if (boardIsHeld(board, held, boardFromUrl)) continue;
    out.push(board);
    rememberHold(held, { company: board.company, ats: board.ats, slug: board.slug, url: board.source_url }, boardFromUrl);
  }
  return out;
}

function heldCompanyLabels(jobs, boardFromUrl) {
  const out = [];
  const seen = new Set();
  const push = (label, slug) => {
    const name = String(label || '').trim();
    if (!name || !slug || PLACEHOLDER.has(slug) || seen.has(slug)) return;
    seen.add(slug);
    out.push(name);
  };
  for (const job of jobs || []) {
    const name = String((job && (job.company || job.name)) || '').trim();
    push(name, companySlug(name));
    if (typeof boardFromUrl !== 'function' || !job) continue;
    const board = boardFromUrl(job.url) || boardFromUrl(job.posting);
    if (board && board.slug) push(board.slug, companySlug(board.slug));
  }
  return out;
}

function escapeRe(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textHasCompany(text, company) {
  const name = String(company || '').trim();
  const slug = companySlug(name);
  if (!slug || slug.length < 3 || PLACEHOLDER.has(slug)) return false;
  const raw = String(text || '');
  if (name.length >= 3 && new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(name)}(?:[^A-Za-z0-9]|$)`, 'i').test(raw)) {
    return true;
  }
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => word.length >= 3 && companySlug(word) === slug);
}

function sameHref(a, b) {
  const left = String(a || '').trim().replace(/\/+$/, '').toLowerCase();
  const right = String(b || '').trim().replace(/\/+$/, '').toLowerCase();
  return Boolean(left) && left === right;
}

function urlAlreadyStored(row, jobs) {
  const hrefs = [row && row.url, row && row.href, row && row.posting, row && row.linkedin].filter(Boolean);
  for (const job of jobs || []) {
    for (const have of [job && job.url, job && job.posting, job && job.linkedin]) {
      if (hrefs.some((href) => sameHref(href, have))) return true;
    }
  }
  return false;
}

/** True when this card or page is a URL or company already stored. Title and link text only, not the JD body. */
function listingAlreadyHeld(row, jobs, boardFromUrl) {
  const src = row && typeof row === 'object' ? row : {};
  if (urlAlreadyStored(src, jobs)) return true;
  const held = heldSet(jobs, boardFromUrl);
  if (
    isHeld(
      {
        url: src.url || src.href,
        posting: src.posting,
        linkedin: src.linkedin,
        company: src.company,
      },
      held,
      boardFromUrl
    )
  ) {
    return true;
  }
  const blob = `${src.name || ''} ${src.title || ''} ${src.company || ''}`;
  return heldCompanyLabels(jobs, boardFromUrl).some((label) => textHasCompany(blob, label));
}

function formatCompanyHeld(n) {
  const count = Number(n) || 0;
  if (!count) return '';
  return `Skipped ${count} from companies already listed.`;
}

module.exports = {
  companySlug,
  holdKeys,
  heldSet,
  isHeld,
  rememberHold,
  pickOnePerCompany,
  boardIsHeld,
  boardsToFetch,
  heldCompanyLabels,
  textHasCompany,
  listingAlreadyHeld,
  formatCompanyHeld,
};
