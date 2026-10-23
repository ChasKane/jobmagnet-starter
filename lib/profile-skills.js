const { normalizeQuestion } = require('./normalize');

const EXTRA_ALIASES = {
  vue: ['vuejs', 'vue.js', 'vue js'],
  angular: ['angularjs', 'angular.js', 'angular js', 'angular 2'],
  react: ['reactjs', 'react.js', 'react js'],
};

const STACK_CANON = {
  vuejs: 'vue',
  'vue js': 'vue',
  angularjs: 'angular',
  'angular js': 'angular',
  'angular 2': 'angular',
  reactjs: 'react',
  'react js': 'react',
  nodejs: 'node',
  'node js': 'node',
  nextjs: 'nextjs',
  'next js': 'nextjs',
  sveltekit: 'sveltekit',
  'svelte kit': 'sveltekit',
};

const SKIP_NAMED = new Set([
  'experience',
  'coding',
  'programming',
  'software',
  'production',
  'years',
  'year',
  'you',
  'have',
  'hands',
  'hand',
  'on',
  'the',
  'a',
  'an',
  'do',
  'this',
  'that',
  'your',
  'using',
  'with',
]);

let cached = null;

function invalidate() {
  cached = null;
}

function canonStackId(token) {
  const t = normalizeQuestion(token);
  if (!t) return '';
  if (STACK_CANON[t]) return STACK_CANON[t];
  const compact = t.replace(/\s+/g, '');
  if (STACK_CANON[compact]) return STACK_CANON[compact];
  return compact;
}

function extractNamedStack(label) {
  const key = normalizeQuestion(label);
  if (!key) return '';
  const m =
    key.match(/\b(?:with|using)\s+([a-z][a-z0-9.+ ]{1,40})$/) ||
    key.match(/\bexperience(?: do you have)? (?:with|using|in) ([a-z][a-z0-9.+ ]{1,40})$/) ||
    key.match(/\byears of ([a-z][a-z0-9.+]{1,32}) experience\b/);
  if (!m) return '';
  const id = canonStackId(m[1]);
  if (!id || id.length < 2 || SKIP_NAMED.has(id)) return '';
  return id;
}

function skillEntries(profile) {
  if (!profile && cached) return cached;
  const { stacksFromProfile, load } = require('./profile-facts');
  const stacks = stacksFromProfile(profile || load());
  const out = [];
  for (const [id, row] of Object.entries(stacks)) {
    const aliases = [id, ...((row && row.aliases) || []), ...(EXTRA_ALIASES[id] || [])]
      .map((a) => normalizeQuestion(a))
      .filter(Boolean);
    out.push({
      id,
      years: row && row.years != null ? Number(row.years) : 0,
      since: (row && row.since) || '',
      aliases,
    });
  }
  if (!profile) cached = out;
  return out;
}

function aliasNeedles(profile) {
  const needles = [];
  for (const skill of skillEntries(profile)) {
    for (const alias of skill.aliases) {
      needles.push({ alias, skill });
    }
  }
  needles.sort((a, b) => b.alias.length - a.alias.length);
  return needles;
}

function parseYearMonth(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
}

/** Merged time actually on the employment list. Calendar span in skills can be longer. */
function employedYears(profile) {
  let jobs = profile && Array.isArray(profile.employment) ? profile.employment : null;
  if (!jobs) {
    if (profile && typeof profile === 'object') return null;
    try {
      jobs = require('./profile-facts').load().employment || [];
    } catch {
      return null;
    }
  }
  const now = Date.now();
  const ranges = [];
  for (const job of jobs) {
    const start = parseYearMonth(job && job.start);
    if (start == null) continue;
    const end = job.current || !job.end ? now : parseYearMonth(job.end);
    if (end == null || end < start) continue;
    ranges.push([start, end]);
  }
  if (!ranges.length) return null;
  ranges.sort((a, b) => a[0] - b[0]);
  let s = ranges[0][0];
  let e = ranges[0][1];
  let ms = 0;
  for (let i = 1; i < ranges.length; i++) {
    const a = ranges[i][0];
    const b = ranges[i][1];
    if (a <= e) e = Math.max(e, b);
    else {
      ms += e - s;
      s = a;
      e = b;
    }
  }
  ms += e - s;
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

function matchSkill(label, profile) {
  const key = normalizeQuestion(label);
  if (!key) return null;
  const entries = skillEntries(profile);
  const named = extractNamedStack(label);
  if (named) {
    const existing = entries.find((s) => s.id === named || (s.aliases || []).includes(named));
    if (existing) return existing;
    // "React Native" is not the React skill. Do not let a shorter alias answer it.
    return { id: named, years: null, since: '', aliases: [named] };
  }
  for (const { alias, skill } of aliasNeedles(profile)) {
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(key)) return skill;
  }
  if (/\byears\b/.test(key) && /\b(coding|programming)\b/.test(key)) {
    return entries.find((s) => s.id === 'coding') || null;
  }
  if (/\byears\b/.test(key) && /\bhands?\s*on experience\b/.test(key) && !/\bwith\b/.test(key)) {
    return entries.find((s) => s.id === 'coding') || null;
  }
  if (/\byears\b/.test(key) && /\b(engineering|professional|production code|software develop)\b/.test(key)) {
    return entries.find((s) => s.id === 'production') || null;
  }
  return null;
}

function yearsForLabel(label, profile) {
  const skill = matchSkill(label, profile);
  if (!skill || skill.years == null) return null;
  return skill.years;
}

function yearsForThreshold(label, profile) {
  const skill = matchSkill(label, profile);
  if (!skill || skill.years == null) return null;
  if (skill.id === 'production') {
    const worked = employedYears(profile);
    if (worked != null && worked < skill.years) return worked;
  }
  return skill.years;
}

function yearsAnswer(label, profile) {
  const n = yearsForLabel(label, profile);
  return n == null ? null : String(n);
}

module.exports = {
  EXTRA_ALIASES,
  invalidate,
  canonStackId,
  extractNamedStack,
  skillEntries,
  matchSkill,
  employedYears,
  yearsForLabel,
  yearsForThreshold,
  yearsAnswer,
};
