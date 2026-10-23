/** Closest dropdown option for a profile value. Alias groups beat leaving the field blank. */

function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

const GROUPS = {
  us: ['us', 'usa', 'unitedstates', 'unitedstatesofamerica', 'america', 'unitedstatesamerica'],
  bachelor: [
    'bachelor',
    'bachelors',
    'bachelordegree',
    'bachelorsdegree',
    'bachelorofscience',
    'bachelorofarts',
    'bachelorofsciencebs',
    'bs',
    'ba',
    'bsc',
    'undergraduate',
    'undergrad',
    'bachelorsdegreeundergraduate',
  ],
  master: ['master', 'masters', 'masterdegree', 'mastersdegree', 'masterofscience', 'mba', 'ms', 'msc', 'graduate'],
  doctorate: ['phd', 'ph.d', 'doctorate', 'doctoral', 'doctorofphilosophy'],
  associate: ['associate', 'associates', 'associatedegree', 'aa', 'as'],
  highschool: ['highschool', 'highschooldiploma', 'ged', 'secondary', 'highschoolorequivalent'],
  fl: ['fl', 'florida'],
  wa: ['wa', 'washington'],
  veteran: [
    'notaveteran',
    'iamnotaveteran',
    'iamnotaprotectedveteran',
    'notaprotectedveteran',
    'noveteran',
    'donotidentifyasaveteran',
  ],
};

function groupFromFold(f) {
  if (!f) return '';
  for (const [g, aliases] of Object.entries(GROUPS)) {
    if (aliases.some((a) => f === a)) return g;
  }
  for (const [g, aliases] of Object.entries(GROUPS)) {
    // "america" is 7 chars and matches American Samoa. Require a long token.
    if (aliases.some((a) => a.length >= 8 && (f.includes(a) || a.includes(f)))) return g;
  }
  return '';
}

function groupOf(text) {
  const raw = String(text || '');
  const f = fold(raw);
  if (/\b(ph\.?\s*d\.?|doctorate|doctoral)\b/i.test(raw)) return 'doctorate';
  if (/\b(m\.?\s*s\.?|m\.?\s*a\.?|mba|msc|master)/i.test(raw)) return 'master';
  if (/\b(b\.?\s*s\.?|b\.?\s*a\.?|bsc|bachelor)/i.test(raw)) return 'bachelor';
  if (/\b(a\.?\s*a\.?|a\.?\s*s\.?|associate)/i.test(raw)) return 'associate';
  if (/\b(high school|ged|secondary)\b/i.test(raw)) return 'highschool';
  return groupFromFold(f);
}

function sameGroup(a, b) {
  const ga = groupOf(a);
  const gb = groupOf(b);
  return Boolean(ga && gb && ga === gb);
}

function placeholderOption(s) {
  return /^(select|select one|choose|choose one|pick|pick one|please select|n\/a|\.{2,})(\.\.\.)?$/i.test(
    String(s || '').trim()
  );
}

function isBareBool(s) {
  return /^(true|false|yes|no|on|off|1|0)$/i.test(String(s || '').trim());
}

function isPolarityLabel(label) {
  const L = String(label || '').toLowerCase();
  return /transgender|\bgender\b|\bsex\b|hispanic|latino|\brace\b|ethnicit|veteran|disabilit|consent|recording|brighthire|metaview|summarization|background (check|screen)|acknowledge|sponsor|work visa|require authorization|will you now or in the future|do you have .{0,80}degree|equivalent (technical )?experience|family member|significant other|restrictive covenant|non-competition|brand partners|refer you|employee refer/.test(
    L
  );
}

function usePolarityMatch(label, wants) {
  const list = (Array.isArray(wants) ? wants : [wants]).map((w) => String(w || '').trim()).filter(Boolean);
  if (!list.length) return false;
  if (isPolarityLabel(label)) return true;
  if (list.some((w) => /inary|queer|nonbinary|hispanic|latino|sponsorship|acknowledge|agree|consent|opt out/i.test(w))) {
    return true;
  }
  return list.every((w) => isBareBool(w));
}

function blockedByNegation(hay, candidate) {
  const h = String(hay || '');
  const c = String(candidate || '');
  if (/hispanic|latino/i.test(c) && !/not hispanic|not latino/i.test(c) && /not hispanic|not latino/i.test(h)) return true;
  if (/hispanic|latino/i.test(h) && !/not hispanic|not latino/i.test(h) && /not hispanic|not latino/i.test(c)) return true;
  return false;
}

function escapeReg(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole word anywhere in the option. "no" matches "…, no" and misses "Illinois". */
function containsWholeWord(hay, word) {
  const w = String(word || '').trim();
  if (!w) return false;
  return new RegExp('\\b' + escapeReg(w) + '\\b', 'i').test(String(hay || ''));
}

function boolToken(s) {
  const m = String(s || '').match(/\b(yes|no)\b/i);
  return m ? m[1].toLowerCase() : '';
}

/** Yes === "Yes, I intend to work remotely." — not Non-binary vs Decline. */
function boolLeadIn(intended, current) {
  const a = boolToken(intended);
  const b = boolToken(current);
  return Boolean(a && b && a === b);
}

function optionLabels(field) {
  return ((field && field.options) || [])
    .map((o) => String((o && (o.text || o.label || o.value)) || o).trim())
    .filter((o) => o && !placeholderOption(o));
}

function currentMatchesOption(current, field) {
  const cur = String(current || '').trim();
  if (!cur || placeholderOption(cur)) return '';
  const fc = fold(cur);
  return optionLabels(field).find((o) => fold(o) === fc || o === cur) || '';
}

function parseAgeBounds(text) {
  const s = String(text || '');
  if (/prefer not|decline|do not wish|don'?t wish/i.test(s)) return null;
  const plus = s.match(/\b(\d{2})\s*(?:\+|or older|and over|and above)\b/i);
  if (plus) return { min: Number(plus[1]), max: 120 };
  const younger = s.match(/\b(\d{1,2})\s*or younger\b/i);
  if (younger) return { min: 0, max: Number(younger[1]) };
  const under = s.match(/\bunder\s*(\d{1,2})\b/i);
  if (under) return { min: 0, max: Number(under[1]) - 1 };
  const range = s.match(/(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  return null;
}

function ageFromValue(text) {
  const s = String(text || '').trim();
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 16 && n <= 100 ? n : null;
  }
  return null;
}

function pickAgeOption(opts, age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return '';
  const hits = (opts || []).filter((o) => {
    const b = parseAgeBounds(o);
    return b && n >= b.min && n <= b.max;
  });
  if (!hits.length) return '';
  hits.sort((a, b) => {
    const ba = parseAgeBounds(a);
    const bb = parseAgeBounds(b);
    const spanA = ba.max - ba.min;
    const spanB = bb.max - bb.min;
    if (spanA !== spanB) return spanA - spanB;
    return Math.abs(ba.min - n) - Math.abs(bb.min - n);
  });
  return hits[0];
}

function ageRangeFallbacks(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return [];
  const decade = Math.floor(n / 10) * 10;
  const commons = [
    [18, 24],
    [25, 34],
    [35, 44],
    [45, 54],
    [55, 64],
    [18, 20],
    [21, 29],
    [30, 39],
    [40, 49],
    [50, 59],
    [18, 29],
  ];
  const out = [];
  if (decade >= 20) {
    out.push(`${decade}-${decade + 9}`, `${decade} – ${decade + 9}`, `${decade} to ${decade + 9}`);
  }
  for (const [a, b] of commons) {
    if (n >= a && n <= b) out.push(`${a}-${b}`, `${a} – ${b}`, `${a} to ${b}`);
  }
  if (n >= 60) out.push('60+', '60 or older');
  return [...new Set(out)];
}

function placeHead(text) {
  return fold(String(text || '').split(',')[0]);
}

function placeHeadConflicts(option, want) {
  const oh = placeHead(option);
  const wh = placeHead(want);
  if (!oh || !wh || oh === wh) return false;
  return oh.startsWith(wh) && oh.length > wh.length;
}

function rankHits(hits, intended) {
  const f = fold(intended);
  if (/science|b\.?\s*s\.?|bsc/i.test(intended)) {
    const sci = hits.find((h) => /science|b\.?\s*s|bsc/i.test(h));
    if (sci) return sci;
  }
  if (/\barts\b|b\.?\s*a\.?\b/i.test(intended)) {
    const arts = hits.find((h) => /arts|\bba\b/i.test(h));
    if (arts) return arts;
  }
  const wh = placeHead(intended);
  const exactHead = wh ? hits.filter((h) => placeHead(h) === wh) : [];
  const pool = exactHead.length ? exactHead : hits.filter((h) => !placeHeadConflicts(h, intended));
  const list = pool.length ? pool : hits;
  return list.slice().sort((a, b) => Math.abs(fold(a).length - f.length) - Math.abs(fold(b).length - f.length))[0];
}

function aliasFallbacks(intended, kind) {
  const g = kind === 'degree' ? groupOf(intended) || 'bachelor' : groupOf(intended);
  if (!g || !GROUPS[g]) return [];
  const labels = {
    us: ['United States', 'United States of America', 'USA', 'US', 'America'],
    bachelor: [
      "Bachelor's",
      "Bachelor's Degree",
      'Bachelor of Science',
      'Bachelor of Arts',
      'Bachelors',
      'Undergraduate',
      'BS',
      'B.S.',
      'BA',
    ],
    master: ["Master's", "Master's Degree", 'Master of Science', 'Graduate', 'MS', 'M.S.', 'MBA'],
    doctorate: ['PhD', 'Ph.D.', 'Doctorate', 'Doctoral'],
    associate: ["Associate's", "Associate's Degree", 'Associate', 'AA'],
    highschool: ['High School', 'High School Diploma', 'GED', 'Secondary'],
    fl: ['Florida', 'FL'],
    wa: ['Washington', 'WA'],
  };
  return labels[g] || [];
}

function polarityRegexes(label, wants) {
  const list = (Array.isArray(wants) ? wants : [wants]).map((w) => String(w || '').trim()).filter(Boolean);
  if (!usePolarityMatch(label, list)) return [];
  const L = String(label || '').toLowerCase();
  const want = list[0] || '';
  const wantBool = /^(true|yes|on|1)$/i.test(want);
  const wantNo = /^(false|no|off|0)$/i.test(want);

  if (/transgender/.test(L)) {
    const transYes = wantBool || list.some((w) => containsWholeWord(w, 'yes'));
    return transYes
      ? [/^\s*yes\s*$/i, /\byes\b/i, /i (am|identify as) transgender/i]
      : [/^\s*no\s*$/i, /\bno\b/i, /do not identify|not transgender/i, /prefer not|decline|do not wish/i];
  }
  if (/\bgender\b|\bsex\b/.test(L) || list.some((w) => /inary|nonbinary|genderqueer/i.test(w))) {
    const res = [];
    if (list.some((w) => /non-?\s*binary|nonbinary/i.test(w))) res.push(/non-?\s*binary|nonbinary/i);
    if (list.some((w) => /\bgenderqueer\b/i.test(w))) res.push(/\bgenderqueer\b/i);
    if (list.some((w) => /prefer not|decline|do not wish/i.test(w))) {
      res.push(/decline to self[- ]identify|self[- ]identify|prefer not|do not wish|decline to answer/i);
    }
    if (list.some((w) => /^(male|man|female|woman)$/i.test(w))) res.push(/\b(male|man|female|woman)\b/i);
    if (!res.length) res.push(/non-?\s*binary|nonbinary/i);
    return res;
  }
  if (/hispanic|latino/.test(L) || list.some((w) => /hispanic|latino/i.test(w))) {
    const hisYes = !wantNo && list.some((w) => /hispanic|latino/i.test(w) || containsWholeWord(w, 'yes'));
    return hisYes ? [/^\s*yes\s*$/i, /\byes\b/i] : [/^\s*no\s*$/i, /\bno\b/i, /not hispanic|not latino/i];
  }
  if (/\brace\b|ethnicit/.test(L) && !/hispanic|latino/.test(L)) {
    return [/two or more/i, /white|caucasian/i, /prefer not|decline|do not wish/i];
  }
  if (/veteran/.test(L)) {
    if (wantNo || list.some((w) => /not a|i am not|^no$/i.test(w))) {
      return [/^\s*not a veteran\s*$/i, /\bnot a (protected )?veteran\b/i, /i am not a (protected )?veteran/i];
    }
    return [/protected veteran|\bi am a veteran|identify as/i, /^\s*yes\s*$/i, /\byes\b/i];
  }
  if (/disabilit/.test(L)) {
    const disYes = wantBool || list.some((w) => containsWholeWord(w, 'yes'));
    return disYes ? [/\byes\b/i] : [/\bno\b/i, /don'?t wish|prefer|decline/i];
  }
  if (/consent|recording|brighthire|metaview|summarization/.test(L) || list.some((w) => /i agree|i consent|opt out/i.test(w))) {
    if (wantNo || list.some((w) => /opt out|do not consent|unrecorded/i.test(w))) {
      return [/opt out|do not consent|unrecorded|manual/i, /^\s*no\s*$/i];
    }
    return [/i agree|i consent|acknowledge|i have read|affirmative/i, /^\s*yes\s*$/i];
  }
  if (/background (check|screen)|acknowledge/.test(L) || list.some((w) => /acknowledge|agree|consent/i.test(w))) {
    if (wantNo) return [/^\s*no\s*$/i, /do not|don'?t/i];
    return [/acknowledge|agree|consent|i understand|i have read/i, /^\s*yes\s*$/i];
  }
  if (
    /do you have .{0,80}degree|equivalent (technical )?experience/.test(L) &&
    list.every((w) => isBareBool(w) || /equivalent/i.test(w))
  ) {
    if (wantNo) return [/\bno\b/i];
    return [/\byes\b/i, /equivalent/i];
  }
  if (/sponsor|work visa|require authorization|will you now or in the future/.test(L) || list.some((w) => /sponsorship/i.test(w))) {
    if (wantNo) return [/\bno\b/i, /will not need|do not need|no sponsorship|not need sponsorship/i];
    return [/\byes\b/i, /will need sponsorship/i];
  }
  if (/family member|significant other|restrictive covenant|non-competition|brand partners|refer you|employee refer/.test(L)) {
    if (wantNo) {
      return [/no relationship|not related|none of the above|no one/i, /^\s*no\s*$/i, /\bno\b/i];
    }
    return [/immediate family|spouse|partner|significant other/i, /\byes\b/i];
  }
  if (wantNo) return [/\bno\b/i, /^\s*false\s*$/i, /will not need|do not need/i];
  if (wantBool) return [/\byes\b/i, /acknowledge|agree|consent|i understand|i have read/i, /^\s*true\s*$/i];
  return [];
}

function optionDialCode(text) {
  const m = String(text || '').match(/\+(\d{1,4})\b/);
  return m ? m[1] : '';
}

function looksLikeDialCountryList(options) {
  const list = (options || []).map((o) => String((o && (o.text || o.label || o.value)) || o || '').trim()).filter(Boolean);
  if (list.length < 6) return false;
  let n = 0;
  for (const o of list) {
    if (/\+\d{1,4}\b/.test(o)) n += 1;
  }
  return n >= 4;
}

function looksLikeDialCountryValue(value) {
  const s = String(value || '').trim();
  // ITI option text is "Cayman Islands+1", not the widget display "United States +1".
  return /[A-Za-z]\+\d{1,4}$/.test(s);
}

function isPhoneCountryLabel(label) {
  return /phone country|country code|dial code|^country$|country of|mailing country/i.test(String(label || ''));
}

function wantDialCode(candidate) {
  const s = String(candidate || '').trim();
  if (/^(us|usa|united states|united states of america|america)$/i.test(s)) return '1';
  if (/^\+?1$/.test(s)) return '1';
  const plus = s.match(/^\+(\d{1,4})$/);
  return plus ? plus[1] : '';
}

function pickDialOption(opts, intended) {
  const want = wantDialCode(intended);
  if (!want) return '';
  const coded = (opts || []).filter((o) => optionDialCode(o) === want);
  if (!coded.length) return '';
  if (want === '1') {
    const us = coded.find((o) => /united states|\busa\b/i.test(o) && !/canada/i.test(o));
    if (us) return us;
  }
  return coded.length === 1 ? coded[0] : '';
}

function optionSetKind(options) {
  const opts = (options || []).map((o) => String(o || '').trim()).filter((o) => o && !placeholderOption(o));
  if (opts.length < 2) return '';
  if (opts.some((o) => /disabilit|veteran|hispanic|latino|\bgender\b|ethnic|transgender/i.test(o))) return 'eeo';
  if (opts.every((o) => /^(yes|no|true|false)\b/i.test(o))) return 'yes-no';
  if (opts.some((o) => /\b(yes|no)\b/i.test(o))) return 'yes-no';
  return 'named';
}

function pickClosestOption(options, intended, fallbacks, label) {
  const wants = [intended, ...(Array.isArray(fallbacks) ? fallbacks : [])]
    .map((w) => String(w || '').trim())
    .filter((w, i, a) => w && a.indexOf(w) === i);
  const opts = (options || []).map((o) => String(o || '').trim()).filter((o) => o && !placeholderOption(o));
  if (!wants.length) return { value: '', confidence: 'none', option: null };
  if (!opts.length) return { value: wants[0], confidence: 'none', option: null, intended: wants[0] };
  if (looksLikeDialCountryList(opts) && !isPhoneCountryLabel(label)) {
    return { value: wants[0], confidence: 'none', option: null, intended: wants[0] };
  }

  for (const w of wants) {
    const hit = opts.find((o) => fold(o) === fold(w));
    if (hit) return { value: hit, confidence: 'exact', option: hit, intended: w };
  }

  for (const w of wants) {
    if (!looksLikeDialCountryList(opts)) break;
    const hit = pickDialOption(opts, w);
    if (hit) {
      return {
        value: hit,
        confidence: 'alias',
        option: hit,
        intended: w,
        reason: 'Picked "' + hit + '" as closest to "' + w + '".',
      };
    }
  }

  for (const w of wants) {
    const age = ageFromValue(w);
    if (age == null) continue;
    const hit = pickAgeOption(opts, age);
    if (hit) {
      return {
        value: hit,
        confidence: 'alias',
        option: hit,
        intended: w,
        reason: 'Picked "' + hit + '" as the age range that contains ' + age + '.',
      };
    }
  }

  for (const w of wants) {
    const g = groupOf(w);
    if (!g) continue;
    const hits = opts.filter((o) => groupOf(o) === g && !blockedByNegation(o, w));
    if (hits.length) {
      const hit = rankHits(hits, w);
      return {
        value: hit,
        confidence: 'alias',
        option: hit,
        intended: w,
        reason: 'Picked "' + hit + '" as closest to "' + w + '".',
      };
    }
  }

  for (const w of wants) {
    const tokens = String(w)
      .split(/[^A-Za-z0-9]+/)
      .filter((t) => t.length >= 3);
    if (!tokens.length) continue;
    const hits = opts.filter((o) => {
      if (blockedByNegation(o, w)) return false;
      if (placeHeadConflicts(o, w)) return false;
      const optionTokens = String(o)
        .split(/[^A-Za-z0-9]+/)
        .filter((t) => t.length >= 3);
      const optionHasWant = tokens.every((t) => containsWholeWord(o, t));
      const wantHasOption = optionTokens.length >= 1 && optionTokens.every((t) => containsWholeWord(w, t)) && fold(o).length >= 5;
      return optionHasWant || wantHasOption;
    });
    if (hits.length) {
      const hit = rankHits(hits, w);
      return {
        value: hit,
        confidence: 'fuzzy',
        option: hit,
        intended: w,
        reason: 'Picked "' + hit + '" as closest to "' + w + '".',
      };
    }
  }

  if (optionSetKind(opts) !== 'named' && usePolarityMatch(label, wants)) {
    for (const re of polarityRegexes(label, wants)) {
      const hits = opts.filter((o) => re.test(o));
      if (hits.length) {
        const hit = rankHits(hits, wants[0]);
        return {
          value: hit,
          confidence: 'polarity',
          option: hit,
          intended: wants[0],
          reason: 'Picked "' + hit + '" as closest to "' + wants[0] + '".',
        };
      }
    }
  }

  return { value: wants[0], confidence: 'none', option: null, intended: wants[0] };
}

function matchesCandidate(hay, candidate) {
  if (!hay || !candidate) return false;
  if (blockedByNegation(hay, candidate)) return false;
  const pick = pickClosestOption([hay], candidate, [], '');
  return Boolean(pick && pick.option);
}

function uncertaintyBetween(intended, current) {
  const a = String(intended || '').trim();
  const b = String(current || '').trim();
  if (!a || !b) return null;
  if (fold(a) === fold(b)) return null;
  if (sameGroup(a, b) || fold(a).includes(fold(b)) || fold(b).includes(fold(a))) {
    return {
      intended: a,
      picked: b,
      confidence: sameGroup(a, b) ? 'alias' : 'fuzzy',
      reason: 'Picked "' + b + '" as closest to "' + a + '".',
    };
  }
  return null;
}

function isChoiceLikeField(field) {
  if (!field) return false;
  const t = String(field.type || '').toLowerCase();
  const tag = String((field && field.tag) || '').toLowerCase();
  const family = String((field.shape && field.shape.family) || '');
  return Boolean(
    field.select ||
      field.reactSelect ||
      t === 'combobox' ||
      t === 'listbox' ||
      t === 'select' ||
      t === 'select-one' ||
      t === 'select-multiple' ||
      tag === 'select' ||
      t === 'checkbox' ||
      t === 'radio' ||
      family === 'choice_group' ||
      family === 'native_select' ||
      family === 'react_select' ||
      family === 'combobox'
  );
}

function isClosedChoiceField(field) {
  if (!field || !isChoiceLikeField(field)) return false;
  return optionLabels(field).length >= 1;
}

function hasCommittedChoice(field) {
  if (!field) return false;
  const t = String(field.type || '').toLowerCase();
  if (t === 'checkbox' || t === 'radio') return Boolean(field.checked);
  if (!isChoiceLikeField(field)) {
    const raw = String(field.value || field.current || '').trim();
    return Boolean(raw) && !placeholderOption(raw);
  }
  const cur = String(field.value || field.current || '').trim();
  if (!cur || placeholderOption(cur)) return false;
  const opts = optionLabels(field);
  if (opts.length) return Boolean(currentMatchesOption(cur, field));
  return true;
}

function parseNumberBounds(text) {
  const s = String(text || '').replace(/[$,]/g, '');
  if (/prefer not|decline|do not wish/i.test(s)) return null;
  const plus = s.match(/(\d+(?:\.\d+)?)\s*(?:\+|or more|and above|and over)\b/i);
  if (plus) return { min: Number(plus[1]), max: Infinity };
  const range = s.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  return null;
}

function pickBandOption(opts, n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  const hits = (opts || []).filter((o) => {
    const b = parseNumberBounds(o);
    return b && num >= b.min && num <= b.max;
  });
  if (!hits.length) return '';
  hits.sort((a, b) => {
    const ba = parseNumberBounds(a);
    const bb = parseNumberBounds(b);
    const spanA = ba.max - ba.min;
    const spanB = bb.max - bb.min;
    if (spanA !== spanB) return spanA - spanB;
    return Math.abs(ba.min - num) - Math.abs(bb.min - num);
  });
  return hits[0];
}

function projectFact(options, intended, projector, label, fallbacks) {
  const opts = (options || []).map((o) => String(o || '').trim()).filter((o) => o && !placeholderOption(o));
  const fact = intended == null ? '' : String(intended).trim();
  const kind = String(projector || 'closest');
  if (!fact) return { value: '', option: null, confidence: 'none', leftover: true };

  if (kind === 'age' || kind === 'age:range') {
    const hit = pickAgeOption(opts, fact);
    if (hit) return { value: hit, option: hit, confidence: 'alias' };
    if (!opts.length) return { value: fact, option: null, confidence: 'exact' };
    const pick = pickClosestOption(opts, fact, fallbacks || ageRangeFallbacks(fact), label);
    if (pick && pick.option) return pick;
    return { value: '', option: null, confidence: 'none', leftover: true };
  }

  if (kind === 'years') {
    if (!opts.length) return { value: fact, option: null, confidence: 'exact' };
    const exact = pickClosestOption(opts, fact, fallbacks, label);
    if (exact && exact.option) return exact;
    const n = Number(fact);
    if (n === 0) {
      const no = opts.find((o) => /^(no|none|0)$/i.test(o));
      if (no) return { value: no, option: no, confidence: 'alias' };
    }
    const band = Number.isFinite(n) ? pickBandOption(opts, n) : '';
    if (band) return { value: band, option: band, confidence: 'alias' };
    return { value: '', option: null, confidence: 'none', leftover: true };
  }

  if (kind === 'salary') {
    const n = Number(String(fact).replace(/[$,]/g, ''));
    if (Number.isFinite(n) && opts.length) {
      const band = pickBandOption(opts, n);
      if (band) return { value: band, option: band, confidence: 'alias' };
    }
    if (!opts.length) return { value: fact, option: null, confidence: 'exact' };
    return pickClosestOption(opts, fact, fallbacks, label);
  }

  if (kind === 'hear_about') {
    const hit = opts.find((o) => /linkedin/i.test(o));
    if (hit) return { value: hit, option: hit, confidence: 'alias' };
    return { value: fact || 'LinkedIn', option: null, confidence: 'none' };
  }

  if (!opts.length) return { value: fact, option: null, confidence: 'exact' };
  const pick = pickClosestOption(opts, fact, fallbacks, label);
  if (pick && pick.option) return pick;
  return { value: fact, option: null, confidence: (pick && pick.confidence) || 'none' };
}

function pageMatcherSource() {
  return [
    'const fold = ' + fold.toString() + ';',
    'const GROUPS = ' + JSON.stringify(GROUPS) + ';',
    'const placeholderOption = ' + placeholderOption.toString() + ';',
    'const isBareBool = ' + isBareBool.toString() + ';',
    'const isPolarityLabel = ' + isPolarityLabel.toString() + ';',
    'const usePolarityMatch = ' + usePolarityMatch.toString() + ';',
    'const escapeReg = ' + escapeReg.toString() + ';',
    'const containsWholeWord = ' + containsWholeWord.toString() + ';',
    'const blockedByNegation = ' + blockedByNegation.toString() + ';',
    'const groupFromFold = ' + groupFromFold.toString() + ';',
    'const groupOf = ' + groupOf.toString() + ';',
    'const parseAgeBounds = ' + parseAgeBounds.toString() + ';',
    'const ageFromValue = ' + ageFromValue.toString() + ';',
    'const pickAgeOption = ' + pickAgeOption.toString() + ';',
    'const ageRangeFallbacks = ' + ageRangeFallbacks.toString() + ';',
    'const placeHead = ' + placeHead.toString() + ';',
    'const placeHeadConflicts = ' + placeHeadConflicts.toString() + ';',
    'const rankHits = ' + rankHits.toString() + ';',
    'const optionSetKind = ' + optionSetKind.toString() + ';',
    'const polarityRegexes = ' + polarityRegexes.toString() + ';',
    'const optionDialCode = ' + optionDialCode.toString() + ';',
    'const wantDialCode = ' + wantDialCode.toString() + ';',
    'const looksLikeDialCountryList = ' + looksLikeDialCountryList.toString() + ';',
    'const looksLikeDialCountryValue = ' + looksLikeDialCountryValue.toString() + ';',
    'const isPhoneCountryLabel = ' + isPhoneCountryLabel.toString() + ';',
    'const pickDialOption = ' + pickDialOption.toString() + ';',
    'const pickClosestOption = ' + pickClosestOption.toString() + ';',
    'const matchesCandidate = ' + matchesCandidate.toString() + ';',
  ].join('\n    ');
}

module.exports = {
  fold,
  groupOf,
  sameGroup,
  aliasFallbacks,
  optionSetKind,
  containsWholeWord,
  parseAgeBounds,
  ageFromValue,
  pickAgeOption,
  ageRangeFallbacks,
  pickClosestOption,
  projectFact,
  parseNumberBounds,
  pickBandOption,
  matchesCandidate,
  usePolarityMatch,
  isBareBool,
  isPolarityLabel,
  polarityRegexes,
  blockedByNegation,
  pageMatcherSource,
  uncertaintyBetween,
  placeholderOption,
  boolLeadIn,
  optionLabels,
  currentMatchesOption,
  isChoiceLikeField,
  isClosedChoiceField,
  hasCommittedChoice,
  looksLikeDialCountryList,
  looksLikeDialCountryValue,
  isPhoneCountryLabel,
};
