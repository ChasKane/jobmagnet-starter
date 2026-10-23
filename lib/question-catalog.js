/** One question catalog: aliases, option signatures, route, fact. */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { normalizeQuestion } = require('./normalize');
const { isInstructionLabel } = require('./question-cascade');
const { isGenericLabel, foldToken } = require('./cluster');
const aliasIndex = require('./alias-index');
const skills = require('./profile-skills');
const { parseAgeBounds, looksLikeDialCountryList, looksLikeDialCountryValue, pickClosestOption } = require('./option-match');

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function aliasFile() {
  return process.env.MAGNET_ALIASES || path.join(__dirname, '..', 'knowledge', 'question-aliases.yaml');
}

const LLM_RE =
  /\b(cover letter|motivation letter|personal statement|what interests you|what made you|in your own words|tell us\b|describe\b|how would you|additional (information|comments|details)|anything else|why (did|do|are|have|would|should|this|you)|examples? of|proud of|please (share|describe|explain|tell)|want to highlight)\b/i;
const SKIP_RE = /\btranscript\b/i;
const EEO_RE =
  /\b(gender identity|sexual orientation|racial\/?ethnic|ethnicit(?:y|ies)|ethnic background|hispanic or latino|veteran status|disability status|lgbtq|transgender|self-identif|eeo|race\/ethnicity|pronouns)\b/i;
const MARKETING_CONSENT_RE =
  /\b(sms|text messages?|whatsapp|marketing opt-?in|consent to receive|job alerts?|talent community)\b/i;
const CONSENT_LIKE_RE =
  /\b(i consent|by checking this box|if you consent|consent to|consent acknowledgment|applicant consent|candidate consent|interview recording|brighthire|metaview|ai summarization|recording and (artificial intelligence|ai)|select ['"“]?affirmative)\b/i;
const EMP_RE =
  /\b(employment history|work history|education history|employer name|i currently work|currently work here|school name)\b/i;
const SHORT_STATIC_RE =
  /\b(job title|current (employer|occupation|title)|phone|email|linkedin|github|website|salary|start date|notice period)\b/i;

const HEAR_TOKS = ['linkedin', 'indeed', 'angellist', 'recruiter', 'jobboard', 'careerfair', 'glassdoor'];

const ROWS = [
  {
    id: 'consent:recording',
    kind: 'consent',
    route: 'static',
    projector: 'polarity',
    aliases: [
      'candidate consent acknowledgment',
      'consent acknowledgment',
      'applicant consent',
      'candidate consent',
      'interview recording',
      'brighthire',
      'metaview',
      'ai summarization',
      'recording and artificial intelligence',
      'recording and ai',
      'by checking this box',
      'if you consent',
      'i consent',
    ],
    optionSignature: (opts) =>
      scoreTokens(opts, ['iagree', 'optout', 'brighthire', 'unrecorded', 'affirmative', 'iconsent']) >= 2,
  },
  {
    id: 'sponsorship',
    kind: 'sponsorship',
    route: 'static',
    projector: 'polarity',
    aliases: [
      'will you now or in the future need',
      'will you now or in the future require',
      'require authorization',
      'require sponsorship',
      'require a visa',
      'visa sponsorship',
      'work visa',
      'work permit',
      'sponsor',
    ],
  },
  {
    id: 'work_auth:us',
    kind: 'work_auth',
    route: 'static',
    projector: 'polarity',
    aliases: ['legally authorized', 'authorized to work', 'work in the united states', 'legally eligible'],
  },
  {
    id: 'location:work_from',
    kind: 'location',
    route: 'static',
    projector: 'alias',
    aliases: [
      'intend to work',
      'from where do you',
      'where will you be working from',
      'where will you work from',
      'remote working location',
      'remote work location',
    ],
  },
  {
    id: 'location:hubs',
    kind: 'location',
    route: 'static',
    projector: 'closest',
    aliases: [
      'relative to our hubs',
      'based relative to our hubs',
      'nearest office',
      'nearest hub',
      'which hub',
      'which of our offices',
      'live near a hub',
      'our hubs',
    ],
  },
  {
    id: 'location:general',
    kind: 'location',
    route: 'static',
    projector: 'alias',
    aliases: [
      'what is your location',
      'current location',
      'where are you located',
      'where are you based',
      'where do you reside',
    ],
  },
  {
    id: 'location:in_us',
    kind: 'location',
    route: 'static',
    projector: 'polarity',
    aliases: [
      'based in the united states',
      'based in the us or canada',
      'based in the united states or canada',
      'reside in the united states',
      'currently reside in the united states',
      'i currently reside in the united states',
    ],
  },
  {
    id: 'identity:country',
    kind: 'location',
    route: 'static',
    projector: 'closest',
    aliases: ['country of residence', 'country of citizenship', 'mailing country'],
    optionSignature: countryOptionSignature,
  },
  {
    id: 'identity:phone',
    kind: 'identity',
    route: 'static',
    projector: 'alias',
    aliases: ['phone number', 'mobile number', 'mobile phone', 'telephone', 'phone'],
  },
  {
    id: 'identity:city',
    kind: 'location',
    route: 'static',
    projector: 'closest',
    aliases: ['mailing city'],
  },
  {
    id: 'identity:state',
    kind: 'location',
    route: 'static',
    projector: 'closest',
    aliases: [
      'state/province',
      'mailing state',
      'state province',
      'permanent residency',
      'hold permanent residency',
      'state do you hold',
    ],
  },
  {
    id: 'referral',
    kind: 'referral',
    route: 'static',
    projector: 'polarity',
    aliases: [
      'did an employee refer',
      'employee refer you',
      'were you referred',
      'referred you to apply',
      'refer you to apply',
    ],
  },
  {
    id: 'conflict:employer',
    kind: 'conflict',
    route: 'static',
    projector: 'polarity',
    aliases: [
      'restrictive covenant',
      'non-competition',
      'non-solicitation',
      'brand partners',
      'family member, spouse or significant other',
      'employed by any of our',
    ],
  },
  {
    id: 'age:range',
    kind: 'age',
    route: 'static',
    projector: 'age',
    aliases: ['age range', 'how old', 'what is your age', 'current age', 'date of birth', 'year of birth', 'birth year'],
    optionSignature: ageOptionSignature,
  },
  {
    id: 'salary:history',
    kind: 'salary',
    route: 'static',
    projector: 'salary',
    aliases: ['current salary', 'currently make', 'last salary', 'salary history', 'histor'],
  },
  {
    id: 'salary:base',
    kind: 'salary',
    route: 'static',
    projector: 'salary',
    aliases: ['salary expectations', 'expected pay', 'pay requirements', 'compensation', 'base salary', 'base pay', 'target comp', 'salary'],
  },
  {
    id: 'hear_about',
    kind: 'hear_about',
    route: 'static',
    projector: 'hear_about',
    aliases: [
      'how did you hear',
      'where did you hear',
      'hear about us',
      'hear about this',
      'hear about the',
      'what prompted you to apply',
    ],
    optionSignature: hearAboutSignature,
  },
  {
    id: 'eeo:orientation',
    kind: 'eeo',
    route: 'static',
    projector: 'closest',
    aliases: ['sexual orientation', 'lgbtq', 'lgbt', 'sogi', 'sexual identity'],
    optionSignature: orientationSignature,
  },
  {
    id: 'eeo:ethnicity',
    kind: 'eeo',
    route: 'static',
    projector: 'closest',
    aliases: ['ethnicity', 'ethnicities', 'ethnicit', 'ethnic background', 'hispanic or latino', 'race/ethnicity'],
    optionSignature: ethnicitySignature,
  },
  {
    id: 'eeo:race',
    kind: 'eeo',
    route: 'static',
    projector: 'closest',
    aliases: ['race not hispanic', 'not hispanic or latino', 'two or more races'],
  },
  {
    id: 'eeo:gender',
    kind: 'eeo',
    route: 'static',
    projector: 'closest',
    aliases: ['gender identity', 'gender', 'sex'],
    optionSignature: genderSignature,
  },
  {
    id: 'eeo:transgender',
    kind: 'eeo',
    route: 'static',
    projector: 'polarity',
    aliases: ['transgender'],
    optionSignature: transgenderSignature,
  },
  {
    id: 'eeo:veteran',
    kind: 'eeo',
    route: 'static',
    projector: 'polarity',
    aliases: ['veteran status', 'veteran'],
    optionSignature: veteranSignature,
  },
  {
    id: 'eeo:disability',
    kind: 'eeo',
    route: 'static',
    projector: 'polarity',
    aliases: ['disability status', 'disability'],
    optionSignature: disabilitySignature,
  },
  {
    id: 'years',
    kind: 'years',
    route: 'static',
    projector: 'years',
    aliases: [
      'how many years',
      'number of years',
      'years of experience do you have',
      'years writing production code',
      'years writing code',
    ],
  },
];

let cachedAuto = null;
let extraAliases = null;

function loadProfileSafe() {
  try {
    return require('./profile-facts').load() || {};
  } catch {
    return {};
  }
}

function mergeProfile(profile) {
  const base = loadProfileSafe();
  if (!profile) return base;
  return {
    ...base,
    ...profile,
    identity: { ...(base.identity || {}), ...(profile.identity || {}) },
    work: { ...(base.work || {}), ...(profile.work || {}) },
    eeo: { ...(base.eeo || {}), ...(profile.eeo || {}) },
    skills: { ...(base.skills || {}), ...(profile.skills || {}) },
  };
}

function fieldLabel(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.label || field.heading || '';
}

function optionTexts(field) {
  return ((field && field.options) || []).map((o) => String(o || '').trim()).filter(Boolean);
}

function isHubsWording(key) {
  return /hubs?|relative to our|nearest office|which hub|nearest (office|site|location)/.test(
    String(key || '')
  );
}

function projectClosest(fact, field) {
  const raw = fact == null ? '' : String(fact).trim();
  if (!raw) return null;
  const pick = pickClosestOption((field && field.options) || [], raw, undefined, fieldLabel(field));
  return (pick && pick.option) || null;
}

function hubsResult(field, profile) {
  const id = (profile && profile.identity) || {};
  const city = id.based_city || '';
  return {
    class: 'location:hubs',
    kind: 'location',
    factValue: projectClosest(city, field),
    route: 'static',
    projector: 'closest',
  };
}

function looksLikeConsent(field) {
  const label = fieldLabel(field);
  const opts = optionTexts(field);
  const blob = [label, ...opts].join(' ');
  if (MARKETING_CONSENT_RE.test(blob)) return false;
  if (CONSENT_LIKE_RE.test(blob) || /\bconsent\b/i.test(blob)) return true;
  if (opts.some((o) => /^(i agree|i consent|affirmative|i acknowledge|i have read)$/i.test(o))) {
    return /\b(agree|acknowledge|affirm|privacy|terms)\b/i.test(blob);
  }
  return false;
}

function consentResult(field, profile) {
  const row = ROWS.find((r) => r.id === 'consent:recording');
  return {
    class: row.id,
    kind: 'consent',
    factValue: factFor(row, field, profile),
    route: 'static',
    projector: 'polarity',
  };
}

function scoreTokens(opts, needles) {
  const folds = (opts || []).map(foldToken);
  let n = 0;
  for (const needle of needles) {
    if (folds.some((f) => f.includes(needle))) n += 1;
  }
  return n;
}

function hearAboutSignature(opts) {
  return scoreTokens(opts, HEAR_TOKS) >= 2;
}

function orientationSignature(opts) {
  return scoreTokens(opts, ['straight', 'heterosexual', 'gay', 'lesbian', 'bisexual', 'queer', 'asexual', 'pansexual']) >= 2;
}

function ethnicitySignature(opts) {
  return (
    scoreTokens(opts, [
      'hispanic',
      'latino',
      'asian',
      'white',
      'black',
      'africanamerican',
      'twoormore',
      'pacificislander',
      'nativeamerican',
    ]) >= 2
  );
}

function genderSignature(opts) {
  return scoreTokens(opts, ['male', 'female', 'nonbinary', 'man', 'woman', 'genderqueer']) >= 2;
}

function transgenderSignature(opts) {
  return scoreTokens(opts, ['transgender']) >= 1 && scoreTokens(opts, ['yes', 'no']) >= 1;
}

function veteranSignature(opts) {
  return scoreTokens(opts, ['veteran', 'protectedveteran']) >= 1;
}

function disabilitySignature(opts) {
  return scoreTokens(opts, ['disability', 'disabled']) >= 1;
}

function countryOptionSignature(opts) {
  if (looksLikeDialCountryList(opts)) return false;
  return scoreTokens(opts, ['unitedstates', 'canada', 'unitedkingdom', 'australia', 'germany', 'india', 'france']) >= 2;
}

function mailingFrom(profile) {
  const id = (profile && profile.identity) || {};
  const mail = id.mailing_address || {};
  return {
    country: id.country || mail.country || 'United States',
    city: id.city || mail.city || '',
    state: id.state || mail.state || '',
    zip: id.zip || mail.zip || '',
  };
}

function isPhoneishLabel(key) {
  return /phone|dial|device type|country code/.test(String(key || ''));
}

function geoResult(field, profile) {
  const key = normalizeQuestion(fieldLabel(field));
  if (isPhoneishLabel(key)) return null;
  const mail = mailingFrom(profile);
  const countryList = countryOptionSignature(optionTexts(field));
  const unlabeled = !key || isGenericLabel(fieldLabel(field)) || isInstructionLabel(fieldLabel(field));
  if (/permanent residenc|hold permanent residenc|state do you hold/.test(key)) {
    return {
      class: 'identity:state',
      kind: 'location',
      factValue: mail.state || null,
      route: 'static',
      projector: 'closest',
    };
  }
  if (
    /^country$/.test(key) ||
    /country of (residence|citizenship)|mailing country/.test(key) ||
    (countryList && (unlabeled || /^country/.test(key) || /\blocation\b/.test(key)))
  ) {
    return {
      class: 'identity:country',
      kind: 'location',
      factValue: mail.country || null,
      route: 'static',
      projector: 'closest',
    };
  }
  if (/^city$|^town$|mailing city/.test(key) && !/state/.test(key)) {
    return {
      class: 'identity:city',
      kind: 'location',
      factValue: mail.city || null,
      route: 'static',
      projector: 'closest',
    };
  }
  if ((/^state$|^province$|state\/?province|mailing state/.test(key) || /^(state|province)(\s|$)/.test(key)) && !/united|city/.test(key)) {
    return {
      class: 'identity:state',
      kind: 'location',
      factValue: mail.state || null,
      route: 'static',
      projector: 'closest',
    };
  }
  if (/zip code|postal code|^zip$|^postal$/.test(key)) {
    return {
      class: 'identity:zip',
      kind: 'location',
      factValue: mail.zip || null,
      route: 'static',
      projector: 'closest',
    };
  }
  return null;
}

function ageOptionSignature(opts) {
  let n = 0;
  for (const o of opts || []) {
    const b = parseAgeBounds(o);
    if (b && b.min >= 16 && b.max >= 18) n += 1;
  }
  return n >= 2;
}

function isRaceOnlyField(field) {
  const key = normalizeQuestion(fieldLabel(field));
  const opts = optionTexts(field).join(' ').toLowerCase();
  const blob = `${key} ${opts}`;
  if (/are you hispanic|hispanic or latino\??$/.test(key) && !/not hispanic|non-hispanic/.test(key)) {
    return false;
  }
  if (/not hispanic|non-hispanic/.test(blob)) return true;
  if (/\btwo or more\b/.test(blob) && /race/.test(blob)) return true;
  return false;
}

function declineOption(field) {
  return optionTexts(field).find((o) =>
    /prefer not|decline|do not wish|do not want to answer|i do not wish/i.test(o)
  );
}

function isChoiceField(field) {
  const type = String((field && (field.type || field.tag)) || '').toLowerCase();
  if (['checkbox', 'radio', 'select', 'select-one', 'combobox', 'listbox'].includes(type)) return true;
  if (field && (field.select || field.reactSelect)) return true;
  const opts = (field && field.options) || [];
  if (looksLikeDialCountryList(opts) && !(field && field.phoneCountry)) return false;
  if (opts.length === 1 && /^(on|true|yes|off|false|no)$/i.test(String(opts[0]))) return true;
  return opts.length >= 2;
}

function isLongOpenPrompt(field, label) {
  if (isChoiceField(field)) return false;
  if (SHORT_STATIC_RE.test(label)) return false;
  const text = String(label || '').trim();
  if (/\?/.test(text) && text.length >= 70) return true;
  const longBox =
    field &&
    (String(field.tag || '').toLowerCase() === 'textarea' ||
      String(field.type || '').toLowerCase() === 'textarea' ||
      field.contenteditable ||
      Number(field.maxlength) >= 200);
  if (
    longBox &&
    /\b(work experience|professional experience|relevant experience|summary|bio|about you)\b/i.test(text) &&
    !isYearsCountPrompt(text)
  ) {
    return true;
  }
  return false;
}

function loadExtraAliases() {
  if (extraAliases) return extraAliases;
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    extraAliases = persist.nodeStore().listAliases().map((row) => ({ class: row.class, phrase: row.phrase }));
    return extraAliases;
  }
  try {
    const doc = yaml.load(fs.readFileSync(aliasFile(), 'utf8')) || {};
    extraAliases = Array.isArray(doc.aliases) ? doc.aliases : [];
  } catch {
    extraAliases = [];
  }
  return extraAliases;
}

function invalidate() {
  cachedAuto = null;
  extraAliases = null;
  skills.invalidate();
}

function isOpenEssayPrompt(label) {
  return LLM_RE.test(String(label || ''));
}

function isSalaryPrompt(label) {
  const key = normalizeQuestion(label);
  if (isOpenEssayPrompt(label)) return false;
  return /\b(salary|compensation|expected pay|pay requirements|base (pay|salary)|target comp)\b/.test(key);
}

function isIdentityNameField(field) {
  if (!field || typeof field === 'string') return false;
  const ac = String(field.autocomplete || '').toLowerCase();
  if (/^(name|nickname|given-name|family-name|fname|lname)$/.test(ac)) return true;
  const dom = String(field.domId || field.name || '');
  if (/systemfield_name$/i.test(dom)) return true;
  if (/^_?name$/i.test(dom) || /^first[_-]?name$/i.test(dom) || /^last[_-]?name$/i.test(dom)) return true;
  if (/\.firstName$/i.test(dom) || /\.lastName$/i.test(dom)) return true;
  return false;
}

function isYearsCountPrompt(label) {
  const key = normalizeQuestion(label);
  if (isOpenEssayPrompt(label)) return false;
  if (/\bhow many years\b|\bnumber of years\b|\b# of years\b/.test(key)) return true;
  if (/\byears of experience do you have\b/.test(key)) return true;
  if (/\byears writing (production )?code\b/.test(key)) return true;
  if (/^(years of|years with|years in)\b/.test(key) && !/\b(do you|have you|at least)\b/.test(key)) return true;
  return false;
}

function isThresholdYearsPrompt(label) {
  if (isOpenEssayPrompt(label)) return false;
  const raw = String(label || '');
  if (/(\d+)\s*\+\s*years?/i.test(raw)) return true;
  const key = normalizeQuestion(label);
  return /\b(at least|or more|minimum of)\b/.test(key) && /\byears?\b/.test(key);
}

function isClosedYesNoPrompt(label) {
  const key = normalizeQuestion(label);
  if (isOpenEssayPrompt(label)) return false;
  if (key.length > 140) return false;
  return /^(have you|do you have|are you familiar with)\b/.test(key);
}

function isClosedFactPrompt(label) {
  return isSalaryPrompt(label) || isYearsCountPrompt(label) || isThresholdYearsPrompt(label) || isClosedYesNoPrompt(label);
}

function extractThreshold(label) {
  const rawPlus = String(label || '').match(/(\d+)\s*\+\s*years?/i);
  if (rawPlus) return Number(rawPlus[1]);
  const key = normalizeQuestion(label);
  const atLeast = key.match(/\b(?:at least|minimum of|min(?:imum)?)\s+(\d+)\b/);
  if (atLeast) return Number(atLeast[1]);
  const plus = key.match(/\b(\d+)\s*\+\s*years?\b/);
  if (plus) return Number(plus[1]);
  const orMore = key.match(/\b(\d+)\s+or more\b/);
  if (orMore) return Number(orMore[1]);
  const word = key.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+or more)?\s+years?\b/
  );
  if (word) return NUMBER_WORDS[word[1]];
  const range = key.match(/\b(\d+)\s*(?:-|to)\s*\d+/);
  if (range && /\byears?\b/.test(key)) return Number(range[1]);
  return null;
}

function meetsThreshold(label, profile) {
  const years = skills.yearsForThreshold(label, profile);
  const n = extractThreshold(label);
  if (years == null) return false;
  if (n == null) return years > 0;
  return years >= n;
}

function yesNoAnswer(label, profile) {
  return meetsThreshold(label, profile) ? 'Yes' : 'No';
}

function aliasNeedles() {
  return aliasEntries()
    .map((e) => String((e && e.needle) || '').toLowerCase().trim())
    .filter((n) => n.length >= 6);
}

function aliasEntries() {
  const out = [];
  for (const row of ROWS) {
    for (const phrase of row.aliases || []) {
      const needle = normalizeQuestion(phrase);
      if (needle) out.push({ needle, payload: { id: row.id, kind: row.kind, row } });
    }
  }
  for (const extra of loadExtraAliases()) {
    const needle = normalizeQuestion(extra.phrase || extra.alias);
    const id = extra.class || extra.id;
    if (!needle || !id) continue;
    const row = ROWS.find((r) => r.id === id) || { id, kind: extra.kind || 'other', route: 'static' };
    out.push({ needle, payload: { id, kind: row.kind, row } });
  }
  return out;
}

function automaton() {
  if (cachedAuto) return cachedAuto;
  cachedAuto = aliasIndex.build(aliasEntries());
  return cachedAuto;
}

function salaryHistoryPrompt(label) {
  return /\b(histor|current salary|currently make|last salary)\b/i.test(String(label || ''));
}

function factFor(row, field, profile) {
  const work = (profile && profile.work) || {};
  const id = (profile && profile.identity) || {};
  const pay = work.compensation || {};
  if (row.id === 'consent:recording') return work.interview_recording_consent !== false ? 'Yes' : 'No';
  if (row.id === 'sponsorship') return work.requires_sponsorship_now_or_future ? 'Yes' : 'No';
  if (row.id === 'work_auth:us') return work.legally_authorized_to_work_us === false ? 'No' : 'Yes';
  if (row.id === 'location:work_from') {
    const city = id.based_city || '';
    const st = id.based_state_code || id.based_state || '';
    if (city && st) return `${city}, ${st}`;
    return city || st || null;
  }
  if (row.id === 'location:general') return id.based_city || null;
  if (row.id === 'location:hubs') return id.based_city || null;
  if (row.id === 'location:in_us') {
    const country = String(mailingFrom(profile).country || id.country || '');
    return /united states|\busa\b|^us$/i.test(country) || !country ? 'Yes' : 'No';
  }
  if (row.id === 'identity:country') return mailingFrom(profile).country || null;
  if (row.id === 'identity:city') return mailingFrom(profile).city || null;
  if (row.id === 'identity:state') return mailingFrom(profile).state || null;
  if (row.id === 'identity:zip') return mailingFrom(profile).zip || null;
  if (row.id === 'identity:phone') return id.phone_national || id.phone || null;
  if (row.id === 'referral' || row.id === 'conflict:employer') return 'No';
  if (row.id === 'age:range') return id.age != null ? String(id.age) : null;
  if (row.id === 'salary:history') return pay.history_usd != null && pay.history_usd !== '' ? String(pay.history_usd) : null;
  if (row.id === 'salary:base') return pay.target_usd != null && pay.target_usd !== '' ? String(pay.target_usd) : null;
  if (row.id === 'hear_about') {
    const hit = optionTexts(field).find((o) => /linkedin/i.test(o));
    return hit || 'LinkedIn';
  }
  const eeo = (profile && profile.eeo) || {};
  if (row.id === 'eeo:orientation') {
    const v = eeo.orientation;
    if (v != null && String(v).trim()) return String(v).trim();
    return declineOption(field) || null;
  }
  if (row.id === 'eeo:race' || (row.id === 'eeo:ethnicity' && isRaceOnlyField(field))) {
    const races = Array.isArray(eeo.race) ? eeo.race : [];
    const race = races[0];
    return race ? String(race).replace(/_/g, ' ') : null;
  }
  if (row.id === 'eeo:ethnicity') {
    const races = Array.isArray(eeo.race) ? eeo.race : [];
    const eth = String(eeo.ethnicity || '');
    if (/hispanic|latino/.test(eth)) return 'Hispanic or Latino';
    const race = races[0];
    if (race) return String(race).replace(/_/g, ' ');
    return eth ? eth.replace(/_/g, ' ') : null;
  }
  if (row.id === 'eeo:gender') {
    const g = eeo.gender || {};
    const key = g.prefer || g.fallback || g.last_resort;
    if (!key) return null;
    if (key === 'nonbinary') return 'Non-binary';
    if (key === 'prefer_not_to_answer') return 'prefer not to answer';
    if (key === 'male') return 'Male';
    if (key === 'female') return 'Female';
    return String(key);
  }
  if (row.id === 'eeo:transgender') {
    const t = eeo.transgender;
    if (t == null || t === '') return null;
    return /^(yes|true)$/i.test(String(t)) ? 'Yes' : 'No';
  }
  if (row.id === 'eeo:veteran') {
    const v = eeo.veteran;
    if (v == null || v === '') return null;
    return /^(yes|true)$/i.test(String(v)) ? 'Yes' : 'No';
  }
  if (row.id === 'eeo:disability') {
    const d = eeo.disability;
    if (d == null || d === '') return null;
    return /^(yes|true)$/i.test(String(d)) ? 'Yes' : 'No';
  }
  return null;
}

function yearsResult(field, profile) {
  const label = fieldLabel(field);
  const key = normalizeQuestion(label);
  const skill = skills.matchSkill(label, profile);
  const named = (skill && skill.id) || skills.extractNamedStack(label);
  const generic =
    !named && (/\b(coding|programming)\b/.test(key) || /\bhands?\s*on experience\b/.test(key));
  const id = named || (generic ? 'coding' : 'unknown');
  let years = skill && skill.years != null ? String(skill.years) : null;
  if (years == null && profile && profile.skills && id && profile.skills[id] && profile.skills[id].years != null) {
    years = String(profile.skills[id].years);
  }
  return {
    class: `years:${id}`,
    kind: 'years',
    skillId: id === 'unknown' ? '' : id,
    factValue: years,
    route: 'static',
    projector: 'years',
  };
}

function optionRescue(field) {
  const opts = optionTexts(field);
  if (opts.length < 2) return null;
  if (looksLikeDialCountryList(opts) && !(field && field.phoneCountry)) return null;
  const unlabeled = !fieldLabel(field) || isInstructionLabel(fieldLabel(field)) || isGenericLabel(fieldLabel(field));
  const key = normalizeQuestion(fieldLabel(field));
  for (const row of ROWS) {
    if (typeof row.optionSignature !== 'function') continue;
    if (!row.optionSignature(opts)) continue;
    if (row.id === 'age:range' && !unlabeled && !/\bage\b|how old|birth/.test(key)) {
      continue;
    }
    if (row.id === 'identity:country' && !unlabeled && !/^country$|country of|mailing country/.test(key)) {
      continue;
    }
    return row;
  }
  return null;
}

function unlabeledResult(field) {
  const key = normalizeQuestion(fieldLabel(field));
  if (!key) return { class: '', kind: 'other', factValue: null, route: 'static', unlabeled: true, projector: 'closest' };
  return {
    class: `other:${key.slice(0, 48)}`,
    kind: 'other',
    factValue: null,
    route: 'static',
    unlabeled: true,
    projector: 'closest',
  };
}

function classify(field, profile) {
  const label = fieldLabel(field);
  const key = normalizeQuestion(label);
  const p = mergeProfile(profile);
  if (!key && !optionTexts(field).length) {
    return { class: '', kind: 'other', factValue: null, route: 'static', unlabeled: true, projector: 'closest' };
  }

  if (isYearsCountPrompt(label)) return yearsResult(field, p);
  if (looksLikeConsent(field)) return consentResult(field, p);
  const geo = geoResult(field, p);
  if (geo) return geo;
  if (isIdentityNameField(field)) {
    return { class: 'identity:name', kind: 'identity', factValue: null, route: 'static', projector: 'alias' };
  }
  if (isSalaryPrompt(label) || /salary|compensation|expected pay|pay requirements/.test(key)) {
    const hist = salaryHistoryPrompt(label);
    const row = ROWS.find((r) => r.id === (hist ? 'salary:history' : 'salary:base'));
    return {
      class: row.id,
      kind: row.kind,
      factValue: factFor(row, field, p),
      route: 'static',
      projector: row.projector,
    };
  }

  const { hit, tie, hits } = aliasIndex.longest(key, automaton());
  if (tie) {
    const ids = new Set((hits || []).map((h) => (h.payload && (h.payload.id || (h.payload.row && h.payload.row.id))) || ''));
    if (ids.has('identity:phone') && ids.has('identity:country')) {
      const phone = ROWS.find((r) => r.id === (/country|dial|code/.test(key) ? 'identity:country' : 'identity:phone'));
      return {
        class: phone.id,
        kind: phone.kind,
        factValue: factFor(phone, field, p),
        route: 'static',
        projector: phone.projector,
      };
    }
    const rescued = optionRescue(field);
    if (rescued) {
      if (rescued.id === 'years') return yearsResult(field, p);
      return {
        class: rescued.id,
        kind: rescued.kind,
        factValue: factFor(rescued, field, p),
        route: rescued.route,
        projector: rescued.projector,
      };
    }
    return { class: '', kind: 'other', factValue: null, route: 'static', unlabeled: true, projector: 'closest', reason: 'tie' };
  }
  if (hit && hit.payload) {
    const row = hit.payload.row || ROWS.find((r) => r.id === hit.payload.id);
    if (row && row.id === 'years') return yearsResult(field, p);
    if (row && row.id === 'work_auth:us') {
      const sponsor = ROWS.find((r) => r.id === 'sponsorship');
      if (sponsor.aliases.some((a) => key.includes(normalizeQuestion(a))) || /sponsor|visa/.test(key)) {
        return {
          class: 'sponsorship',
          kind: 'sponsorship',
          factValue: factFor(sponsor, field, p),
          route: 'static',
          projector: 'polarity',
        };
      }
      if (/\b(canada|uk|united kingdom|australia)\b/.test(key) && !/\b(united states|\bus\b|usa)\b/.test(key)) {
        return {
          class: 'work_auth:foreign',
          kind: 'work_auth',
          factValue: 'No',
          route: 'static',
          projector: 'polarity',
        };
      }
    }
    if (row) {
      if (row.id === 'location:hubs' || (row.id === 'location:general' && isHubsWording(key))) {
        return hubsResult(field, p);
      }
      if (row.id === 'location:general') {
        if (
          /united states|\bus\b|canada/.test(key) &&
          /based|reside/.test(key) &&
          (isChoiceField(field) || /are you|do you|i currently/.test(key))
        ) {
          const inUs = ROWS.find((r) => r.id === 'location:in_us');
          return {
            class: 'location:in_us',
            kind: 'location',
            factValue: factFor(inUs, field, p),
            route: 'static',
            projector: 'polarity',
          };
        }
      }
      if (row.id === 'identity:phone' && /country|dial|code/.test(key)) {
        const country = ROWS.find((r) => r.id === 'identity:country');
        return {
          class: 'identity:country',
          kind: 'location',
          factValue: factFor(country, field, p),
          route: 'static',
          projector: 'closest',
        };
      }
      if (row.id === 'identity:country' && /^phone$|^mobile$|phone number|telephone/.test(key) && !/country|dial|code/.test(key)) {
        const phone = ROWS.find((r) => r.id === 'identity:phone');
        return {
          class: 'identity:phone',
          kind: 'identity',
          factValue: factFor(phone, field, p),
          route: 'static',
          projector: 'alias',
        };
      }
      if ((row.id === 'eeo:ethnicity' || row.id === 'eeo:race') && isRaceOnlyField(field)) {
        const race = ROWS.find((r) => r.id === 'eeo:race') || row;
        return {
          class: 'eeo:race',
          kind: 'eeo',
          factValue: factFor(race, field, p),
          route: 'static',
          projector: 'closest',
        };
      }
      return {
        class: row.id,
        kind: row.kind,
        factValue: factFor(row, field, p),
        route: row.route || 'static',
        projector: row.projector,
      };
    }
  }

  const rescued = optionRescue(field);
  if (rescued) {
    if (rescued.id === 'years') return yearsResult(field, p);
    return {
      class: rescued.id,
      kind: rescued.kind,
      factValue: factFor(rescued, field, p),
      route: rescued.route || 'static',
      projector: rescued.projector,
    };
  }

  if (/family|spouse|significant other/.test(key) && /employ/.test(key)) {
    const row = ROWS.find((r) => r.id === 'conflict:employer');
    return {
      class: row.id,
      kind: row.kind,
      factValue: factFor(row, field, p),
      route: 'static',
      projector: 'polarity',
    };
  }
  if (/restrictive covenant|non-competition|non-solicitation|brand partners/.test(key)) {
    const row = ROWS.find((r) => r.id === 'conflict:employer');
    return {
      class: row.id,
      kind: row.kind,
      factValue: factFor(row, field, p),
      route: 'static',
      projector: 'polarity',
    };
  }

  return unlabeledResult(field);
}

function routeOf(field) {
  const label = fieldLabel(field);
  try {
    const { findRecipe } = require('./field-recipes');
    const recipe = findRecipe({ label, field });
    if (recipe) {
      if (recipe.route === 'skip' || recipe.route === 'needs_llm') {
        return { route: recipe.route, reason: 'recipe' };
      }
    }
  } catch (_) {}

  if (/^window\.__/.test(label) || /ddRumApplicationId|__appData/.test(label)) {
    return { route: 'skip', reason: 'heuristic-junk' };
  }
  if (EMP_RE.test(label) || (field && field.kind === 'employment')) {
    return { route: 'employment', reason: 'heuristic-employment' };
  }
  if (SKIP_RE.test(label)) return { route: 'skip', reason: 'heuristic-skip' };
  if (EEO_RE.test(label)) return { route: 'static', reason: 'heuristic-eeo' };
  if (isClosedFactPrompt(label)) return { route: 'static', reason: 'heuristic-fact' };

  const q = classify(field);
  if (q.kind === 'years' || q.kind === 'salary' || q.kind === 'consent' || q.kind === 'age' || q.kind === 'eeo') {
    return { route: 'static', reason: 'catalog-' + q.kind };
  }
  if (LLM_RE.test(label) || isLongOpenPrompt(field, label)) {
    return { route: 'needs_llm', reason: 'heuristic-llm' };
  }
  if (isChoiceField(field)) return { route: 'static', reason: 'heuristic-choice' };
  if (q.route && q.route !== 'static') return { route: q.route, reason: 'catalog' };
  return { route: 'static', reason: 'heuristic-static' };
}

function aliasClassId(classId) {
  const id = String(classId || '').trim();
  if (!id || id.startsWith('other:') || id === 'skip') return '';
  if (id.startsWith('years:')) return 'years';
  return rowById(id) ? id : '';
}

function chosenClass(hinted) {
  const hint = String(hinted || '').trim();
  if (!hint) return '';
  if (/^(skip|do-not-fill|donotfill|blank)$/i.test(hint)) return 'skip';
  if (aliasClassId(hint) || rowById(hint)) return hint;
  if (/^years:[a-z0-9_]+$/i.test(hint)) return hint;
  if (/^other:[a-z][a-z0-9_]{1,48}$/.test(hint)) return hint;
  return '';
}

function remapClass(field, hinted) {
  const chosen = chosenClass(hinted);
  if (chosen) return chosen;
  const q = classify(field);
  return (q && q.class) || '';
}

function classFitsValue(classId, value, field) {
  const id = String(classId || '').trim();
  const raw = String(value == null ? '' : value).trim();
  if (!id || id === 'skip' || !raw) return false;
  if ((id === 'identity:country' || id === 'location:in_us') && /^\+?\d[\d\s().-]{6,}$/.test(raw)) {
    return false;
  }
  if (looksLikeDialCountryValue(raw) && !(field && field.phoneCountry)) {
    return false;
  }
  if (/^(eeo:|consent:)/.test(id) && /^\+?\d[\d\s().-]{6,}$/.test(raw)) {
    return false;
  }
  if (id === 'identity:phone' && /united states|united kingdom|\bcanada\b/i.test(raw) && !/\d{3}/.test(raw)) {
    return false;
  }
  if (/^salary:/.test(id) && !/\d/.test(raw)) return false;
  if (
    /^(location:general|location:hubs|location:work_from|identity:city|identity:state)$/.test(id) &&
    isChoiceField(field)
  ) {
    const t = String((field && field.type) || '').toLowerCase();
    if ((t === 'checkbox' || t === 'radio') && /suite|street|\d{3,}/i.test(raw) && !/^(yes|no)$/i.test(raw)) {
      return false;
    }
  }
  return true;
}

function learnAlias(classId, phrase) {
  const id = aliasClassId(classId);
  const needle = normalizeQuestion(phrase);
  if (!id || !needle) return null;
  if (require('./store/mode').isSupabase()) {
    const have = loadExtraAliases();
    if (have.some((a) => (a.class || a.id) === id && normalizeQuestion(a.phrase || a.alias) === needle)) {
      return { ok: true, duplicate: true };
    }
    const persist = require('../packages/persist');
    persist.open();
    persist.nodeStore().addAlias(id, String(phrase || '').trim());
    invalidate();
    return { ok: true };
  }
  let doc = { version: 1, aliases: [] };
  try {
    doc = yaml.load(fs.readFileSync(aliasFile(), 'utf8')) || doc;
  } catch (_) {}
  if (!Array.isArray(doc.aliases)) doc.aliases = [];
  if (doc.aliases.some((a) => (a.class || a.id) === id && normalizeQuestion(a.phrase || a.alias) === needle)) {
    return { ok: true, duplicate: true };
  }
  doc.aliases.push({ class: id, phrase: String(phrase || '').trim() });
  fs.writeFileSync(
    aliasFile(),
    yaml.dump({ version: 1, aliases: doc.aliases }, { lineWidth: 100, noRefs: true, sortingKeys: false })
  );
  invalidate();
  return { ok: true };
}

function rowById(id) {
  return ROWS.find((r) => r.id === id) || null;
}

module.exports = {
  ROWS,
  classify,
  aliasNeedles,
  route: routeOf,
  routeOf,
  learnAlias,
  aliasClassId,
  chosenClass,
  remapClass,
  classFitsValue,
  isRaceOnlyField,
  aliasFile,
  invalidate,
  isChoiceField,
  isLongOpenPrompt,
  fieldLabel,
  LLM_RE,
  rowById,
  hearAboutSignature,
  ageOptionSignature,
  isOpenEssayPrompt,
  isSalaryPrompt,
  isIdentityNameField,
  isHubsWording,
  looksLikeConsent,
  isYearsCountPrompt,
  isThresholdYearsPrompt,
  isClosedYesNoPrompt,
  isClosedFactPrompt,
  extractThreshold,
  meetsThreshold,
  yesNoAnswer,
  matchSkill: skills.matchSkill,
  extractNamedStack: skills.extractNamedStack,
  yearsAnswer: skills.yearsAnswer,
  yearsForLabel: skills.yearsForLabel,
};
