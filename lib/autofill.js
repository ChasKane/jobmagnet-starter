const fs = require('fs');
const path = require('path');
const { classifyField, normalizeQuestion } = require('./classify');
const { isInstructionLabel } = require('./normalize');
const {
  findRecipe,
  learnRecipe,
  recipeRunOk,
  hashSource,
  isEphemeralSelector,
  isNoticeStrategy,
  splitRecipeSteps,
  foldPokeIntoSteps,
  looksLikeDateFill,
  recipeDanceReady,
} = require('./field-recipes');
const { INVENTORY_SCRIPT, paintScript, busyScript, PAINT_MISSED_SCRIPT, flashFieldScript, harvestSelectOptionsScript } = require('./paint');
const {
  fillAndVerifyScript,
  readFieldScript,
  attachMirrorScript,
  fieldSelectorScript,
  runStepsScript,
  executeRunScript,
  harvestAttachScript,
  harvestSweepScript,
  harvestPauseScript,
  autoScrollArmScript,
} = require('./static-fill');
const { getEssayWpm, prepareEssayTypeScript, typeTextEvents } = require('./essay-pace');
const {
  compileRecordedEvents,
  pickDecoy,
  formatStep,
  recordStartScript,
  recordStopScript,
  settleFieldScript,
} = require('./fill-record');
const { fingerprint, chainFor, recordWin, recordLoss, flag } = require('./strategy');
const { reviewAskWhy } = require('./review-copy');
const {
  CLICK_APPLY_SCRIPT,
  PAGE_FP_SCRIPT,
  ensurePostingJd,
  isChromeField,
  applyFollowPlan,
  hasVisibleApplyFields,
  applyCtaOf,
  clickNamedApplyScript,
  hrefIsOtherPage,
  hasApplyCue,
} = require('./jd');
const { scanJobDescription } = require('./jd-scan');
const { employmentPlan, ADD_SCRIPT } = require('./employment');
const { spawnNode } = require('./spawn-node');
const { usefulCurrent, preferPostingJd } = require('./essay-prompt');
const { isCannedOpenLetter, isReplaceableEssay, coverLetterText } = require('./open-letter');
const { wantsEssayOverride } = require('./chat-intent');
const { isTightCanaryField, isShortTextField, auditFields, auditLogFields, valuesEqual, looksRequired, isOptionalEmptyField, looksContaminated, wantsCheckedYes } = require('./audit');
const { classifyQuestion, confirmedOrFactValue } = require('./question-class');
const { confirmClass, contradictClass, getConfirmation } = require('./confirmations');
const { reviewGate, filterAskable, shouldAskReview, dropLandedFills } = require('./review-gate');
const { aliasFallbacks, pickClosestOption, projectFact, uncertaintyBetween, hasCommittedChoice, isChoiceLikeField, isClosedChoiceField, placeholderOption, isBareBool, ageRangeFallbacks, pickAgeOption, optionLabels, looksLikeDialCountryList } = require('./option-match');
const { lookupFootprint, rememberFootprint, answerOnOptions } = require('./footprint');
const { widgetShapeName, widgetFamily, clusterDedupeKey, mergeInventoryClusters, shapeFromField, isGenericLabel, questionTextKey } = require('./cluster');
const {
  yearsAnswer,
  yearsForLabel,
  extractNamedStack,
  isYearsCountPrompt,
  isSalaryPrompt,
  isThresholdYearsPrompt,
  isClosedYesNoPrompt,
  isClosedFactPrompt,
  yesNoAnswer,
  matchSkill,
  looksLikeConsent,
} = require('./question-catalog');
const {
  load: loadProfile,
  applyUpdates,
  harvestFromText,
  inferFromText,
  splitExperienceUpdates,
  parseAgeFromText,
} = require('./profile-facts');

const ARCHIVE = path.join(__dirname, '..', 'knowledge', 'archive');

const GENDER_LABELS = {
  nonbinary: ['Non-binary', 'Nonbinary', 'Non binary'],
  prefer_not_to_answer: [
    'Decline to self-identify',
    'Decline to self identify',
    'I do not wish to self-identify',
    'prefer not to answer',
    'I do not wish to answer',
    'Decline to answer',
    'Decline',
    'Prefer not to say',
  ],
  male: ['Male', 'Man'],
  female: ['Female', 'Woman'],
};

const RACE_LABELS = {
  hispanic_latino: ['Hispanic or Latino', 'Hispanic/Latino', 'Latino', 'Hispanic'],
  white: ['White', 'Caucasian', 'White (Not Hispanic or Latino)'],
  black: ['Black or African American', 'Black', 'African American'],
  asian: ['Asian'],
  pacific: ['Native Hawaiian or Other Pacific Islander', 'Pacific Islander'],
  american_indian: ['American Indian or Alaska Native', 'American Indian'],
  two_or_more: ['Two or more races', 'Two or More Races', 'Two or more', 'Multiracial', 'Mixed'],
};

function ageFromProfile(profile) {
  const n = Number(profile && profile.identity && profile.identity.age);
  return Number.isInteger(n) && n >= 18 && n <= 80 ? n : null;
}

function isAgeRangeField(field) {
  const key = normalizeQuestion((field && field.label) || '');
  if (!key) return false;
  if (/\b(years? of|how many years|experience|manage|page)\b/.test(key)) return false;
  return /\bage range\b|\bcurrent age\b|\bhow old\b|\bdate of birth\b|\byear of birth\b|\bbirth ?year\b|\bwhat is your age\b|^\bage\b/.test(
    key
  );
}

function scrubCardIds(text) {
  return String(text || '')
    .replace(/\binternal_id:\s*/gi, '')
    .replace(/\bsource_card_ids\b[:\s]*/gi, '')
    .replace(/#?card_[a-z0-9_]+/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function leftoverStatics(tab) {
  return ((tab && tab.debugFields) || [])
    .filter(
      (f) =>
        f &&
        f.route === 'static' &&
        f.magnetState !== 'skip' &&
        (f.magnetState === 'red' || f.residual)
    )
    .slice(0, 16)
    .map((f) => ({
      id: f.id,
      label: f.label,
      intended: f.intended || '',
      current: f.current || '',
      options: (f.options || []).slice(0, 20),
      residual: f.residual || f.magnetState || '',
    }));
}

function harvestForEssayTurn(instruction) {
  if (String(instruction || '').trim()) return [];
  return harvestFromText(instruction);
}

function essayAutofillStatus({ skipEssays, essayFields, drafted }) {
  const fields = Array.isArray(essayFields) ? essayFields : [];
  const written = skipEssays ? 0 : Number(drafted && drafted.essays) || 0;
  const requiredLeft = fields.filter((f) => looksRequired(f)).length;
  const needsModel = fields.some((f) => !isCannedOpenLetter(f));
  const missingKey = !skipEssays && needsModel && !process.env.CURSOR_API_KEY;
  const draftFailed = !skipEssays && drafted && drafted.ok === false;
  const requiredEmpty = !skipEssays && requiredLeft > 0 && written < requiredLeft;
  const failed = Boolean(missingKey || draftFailed || requiredEmpty);
  let error = (drafted && drafted.error) || '';
  if (failed && !error) error = missingKey ? 'missing CURSOR_API_KEY' : 'required essay still empty';
  let reply = (drafted && drafted.reply) || '';
  if (failed && !String(reply).trim()) {
    reply = missingKey
      ? 'Essay draft failed — missing CURSOR_API_KEY'
      : 'Required essay is still empty.';
  }
  return { ok: !failed, essays: written, reply, error: failed ? error : '' };
}

function chatFromAutofill(drafted) {
  const src = drafted || {};
  return {
    reply: src.reply || '',
    drafts: src.drafts || [],
    asks: src.asks || [],
    tools: src.tools || [],
    sent: src.sent || null,
    received: src.received || null,
  };
}

function chatDigest(tab) {
  return ((tab && tab.chat) || []).slice(-8).map((m) => ({
    role: m && m.role ? String(m.role) : '',
    text: String((m && m.text) || '').slice(0, 400),
  }));
}

// Leftover critic stays a sidecar so it can run beside the Chat/essay agent.
// Share what each already decided via these digests instead of one session.
function reviewDigest(tab) {
  const review = (tab && tab.review) || {};
  return {
    reply: String(review.reply || '').slice(0, 400),
    fills: (review.fills || [])
      .filter((f) => f && !f.accepted && !f.dismissed)
      .slice(0, 24)
      .map((f) => ({
        id: f.id,
        label: f.label || f.id,
        value: f.value || '',
        reason: f.reason || '',
      })),
    asks: (review.asks || [])
      .filter((a) => a && !a.answered)
      .slice(0, 24)
      .map((a) => ({
        id: a.id,
        question: a.question || a.label || '',
        why: a.why || '',
        reason: a.reason || '',
      })),
  };
}

function leftoversForChat(tab, payloadFields, instruction) {
  if (!String(instruction || '').trim()) return { leftovers: [], review_fills: [], review_asks: [] };
  const leftovers = leftoverStatics(tab).filter((row) => !(payloadFields || []).some((f) => f.id === row.id));
  const digest = reviewDigest(tab);
  return {
    leftovers,
    review_fills: digest.fills,
    review_asks: digest.asks,
  };
}

function mailFromProfile(profile) {
  const id = profile.identity || {};
  const m = id.mailing_address || {};
  return {
    line1: m.line1 || '',
    line2: m.line2 || '',
    street: m.street || '',
    city: m.city || id.city || '',
    state: m.state || id.state || '',
    state_code: m.state_code || id.state_code || '',
    zip: String(m.zip || id.zip || ''),
    country: m.country || id.country || '',
  };
}

function salaryFromProfile(profile) {
  const n = profile.work && profile.work.compensation && profile.work.compensation.target_usd;
  return n != null && n !== '' ? String(n) : '';
}

function salaryHistoryFromProfile(profile) {
  const n = profile.work && profile.work.compensation && profile.work.compensation.history_usd;
  return n != null && n !== '' ? String(n) : '';
}

function firstEducation(profile) {
  return (profile && profile.education && profile.education[0]) || {};
}

function latestJob(profile) {
  return (profile && profile.employment && profile.employment[0]) || {};
}

function isRecentJobTitleField(field) {
  const key = fieldBlob(field);
  if (/notice period|sponsor|conflict/.test(key)) return false;
  if (/job title|position title|role title|current occupation/.test(key)) return true;
  if (/\btitle\b/.test(key) && /current|previous|most recent|latest|last/.test(key)) return true;
  return false;
}

function isRecentEmployerField(field) {
  const key = fieldBlob(field);
  if (isRecentJobTitleField(field)) return false;
  if (/notice period|sponsor|conflict of interest/.test(key)) return false;
  if (/who is your .{0,48}employer/.test(key)) return true;
  if (/\b(employer|company)\b/.test(key) && /current|previous|most recent|latest|last/.test(key)) return true;
  return false;
}

function uniqLabels(list) {
  const out = [];
  for (const l of list) {
    if (l && !out.some((x) => x.toLowerCase() === String(l).toLowerCase())) out.push(String(l));
  }
  return out;
}

function genderWants(profile) {
  const g = (profile.eeo && profile.eeo.gender) || {};
  const keys = [g.prefer, g.fallback, g.last_resort].filter(Boolean);
  const out = [];
  for (const k of keys) {
    out.push(...(GENDER_LABELS[k] || [k]));
  }
  return uniqLabels(out);
}

function isRaceOnlyField(field) {
  try {
    return require('./question-catalog').isRaceOnlyField(field);
  } catch (_) {
    return false;
  }
}

function raceWants(profile) {
  const eeo = (profile && profile.eeo) || {};
  const out = [];
  const races = [...(eeo.race || [])];
  if (races.includes('white') && !races.includes('two_or_more')) {
    races.splice(races.indexOf('white'), 0, 'two_or_more');
  }
  for (const r of races) {
    out.push(...(RACE_LABELS[r] || [String(r).replace(/_/g, ' ')]));
  }
  out.push('prefer not to answer', 'I do not wish to answer', 'Decline');
  return uniqLabels(out);
}

function ethnicityWants(profile, field) {
  if (isRaceOnlyField(field)) return raceWants(profile);
  const eeo = profile.eeo || {};
  const out = [];
  const eth = String(eeo.ethnicity || '');
  if (/hispanic|latino/.test(eth)) out.push(...RACE_LABELS.hispanic_latino);
  out.push(...raceWants(profile));
  if (/hispanic|latino/.test(eth)) out.push('Yes');
  return uniqLabels(out);
}

function veteranWants(profile) {
  const v = String((profile.eeo && profile.eeo.veteran) || 'no').toLowerCase();
  if (v === 'yes' || v === 'true') return ['I am a protected veteran', 'Veteran', 'Yes'];
  return ['Not a Veteran', 'I am not a protected veteran', 'I am not a veteran', 'No', 'prefer not to answer'];
}

function disabilityWants(profile) {
  const d = String((profile.eeo && profile.eeo.disability) || '').toLowerCase();
  if (d === 'yes' || d === 'true') return ['Yes', 'Yes, I have a disability', 'I have a disability'];
  return ['No', 'I do not have a disability', 'prefer not to answer'];
}

const ORIENTATION_OPTIONS = [
  'Straight / Heterosexual',
  'Heterosexual or Straight',
  'Gay',
  'Lesbian',
  'Gay or Lesbian',
  'Bisexual',
  'Queer',
  'Asexual',
  'Pansexual',
  'Prefer not to say',
  'Prefer not to answer',
  'I do not wish to answer',
  'Decline to self-identify',
  'Decline',
];

function orientationWants(profile) {
  const o = String((profile && profile.eeo && profile.eeo.orientation) || '').trim();
  const out = [];
  if (o) out.push(o, o.charAt(0).toUpperCase() + o.slice(1));
  out.push('Queer', 'queer', ...ORIENTATION_OPTIONS);
  return uniqLabels(out);
}

function isSelectLikeField(field) {
  if (!field) return false;
  const t = String(field.type || '').toLowerCase();
  const tag = String(field.tag || '').toLowerCase();
  const family = String((field.shape && field.shape.family) || '');
  return Boolean(
    field.select ||
      field.reactSelect ||
      tag === 'select' ||
      t === 'select' ||
      t === 'select-one' ||
      t === 'select-multiple' ||
      t === 'combobox' ||
      t === 'listbox' ||
      family === 'native_select' ||
      family === 'react_select' ||
      family === 'combobox'
  );
}

function isPaceTextField(field) {
  if (!field || isChoiceLikeField(field) || isSelectLikeField(field)) return false;
  const t = String(field.type || '').toLowerCase();
  const tag = String(field.tag || '').toLowerCase();
  if (
    [
      'checkbox',
      'radio',
      'file',
      'hidden',
      'submit',
      'button',
      'reset',
      'image',
      'date',
      'month',
      'week',
      'datetime-local',
      'time',
      'color',
      'range',
    ].includes(t) ||
    tag === 'select'
  ) {
    return false;
  }
  if (field.contenteditable || tag === 'textarea' || t === 'textarea') return true;
  if (tag === 'input' && ['text', 'email', 'tel', 'url', 'search', 'number', 'password', ''].includes(t)) return true;
  if (!tag && ['text', 'email', 'tel', 'url', 'search', 'number', 'password'].includes(t)) return true;
  return false;
}

function wantsPaceType(field, value, wc, ctx) {
  if (!wc || typeof wc.sendInputEvent !== 'function') return false;
  if (ctx && ctx.instant) return false;
  if (!isPaceTextField(field)) return false;
  const text = String(value == null ? '' : value);
  if (!text.trim()) return false;
  if (looksLikeDateFill(field, { value: text })) return false;
  return true;
}

function transgenderWants(profile) {
  const t = String((profile.eeo && profile.eeo.transgender) || '').toLowerCase();
  if (t === 'yes' || t === 'true') {
    return ['Yes', 'Yes, I identify as transgender', 'I am transgender', 'Transgender'];
  }
  return ['No', 'I do not identify as transgender', 'prefer not to answer', 'Decline'];
}

function usefulDomToken(s) {
  const v = String(s || '');
  if (!v) return '';
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(v)) return '';
  if (/^[0-9a-f-]{36}_[0-9a-f-]{8}/i.test(v)) return '';
  return v.replace(/_systemfield_/gi, ' ').replace(/_/g, ' ');
}

function fieldBlob(field) {
  return normalizeQuestion(
    [field.label, usefulDomToken(field.name), usefulDomToken(field.domId)].filter(Boolean).join(' ')
  );
}

function looksBooleanOption(o) {
  return /^(yes|no|true|false|on|off)$/i.test(String(o || '').trim());
}

function isPolarityWidget(field) {
  if (!field) return false;
  if (isYesNoWidget(field)) return true;
  const t = String(field.type || '').toLowerCase();
  if (t !== 'checkbox') return false;
  const opts = optionLabels(field);
  return opts.length <= 1 || opts.every(looksBooleanOption);
}

function isInUsField(field) {
  const key = fieldBlob(field || {});
  if (!/based|reside/.test(key)) return false;
  if (!/united states|\bus\b|canada/.test(key)) return false;
  return isPolarityWidget(field) || /are you|do you|i currently/.test(key);
}

function refuseAddressOnChoice(field, value) {
  if (value == null || value === '') return value;
  if (!isPolarityWidget(field)) return value;
  const s = String(value);
  if (/^(yes|no|true|false)$/i.test(s)) return value;
  if (/suite|apt\.?|\bstreet\b|ave\.|blvd|davie|seattle|florida|\d{3,}/i.test(s)) return null;
  return value;
}

function isLocationField(field) {
  const key = normalizeQuestion((field && field.label) || '');
  if (isPolarityWidget(field) || isInUsField(field)) return false;
  if (/hubs?|relative to/.test(key)) return false;
  if (/mailing|street|address line|zip|postal|phone/.test(key)) return false;
  if (/reject|asian.?pacific|not sustainable|if you live in the/.test(key)) return false;
  if (/sponsor|work permit|work visa|authorized to work|work remotely|plan to work remote/.test(key)) {
    return false;
  }
  const combo = Boolean(
    field && (field.reactSelect || field.type === 'combobox' || field.type === 'search' || field.select)
  );
  if (/start typing|type to search|search for (a )?(city|location)|begin typing/.test(key)) return true;
  if (/what is your location|your current location|^your location$/.test(key)) return true;
  if (/current location|candidate location|where are you (located|based)|city of residence/.test(key)) {
    return true;
  }
  if (/if located in/.test(key) && /city/.test(key)) return true;
  if (/city and state/.test(key) && /resid|located/.test(key)) return true;
  if (/in what city/.test(key) && /resid|located/.test(key)) return true;
  if (/where do you reside/.test(key)) return true;
  if (/^location(\s+city)?$/.test(key)) return true;
  if (combo && /location/.test(key) && !/job location|work location|employment|sponsor|permit|authorized/.test(key)) {
    return true;
  }
  return false;
}

function locationOptionKind(field) {
  const opts = ((field && field.options) || []).map((o) => String(o || ''));
  if (opts.length < 2) return '';
  const countryHits = opts.filter((o) =>
    /united states|\busa\b|^us$|canada|united kingdom|\buk\b|australia|germany|india|france/i.test(o)
  );
  if (countryHits.length >= 2) return 'country';
  const stateHits = opts.filter((o) =>
    /washington|florida|california|new york|texas|oregon|colorado|massachusetts/i.test(o)
  );
  if (stateHits.length >= 2) return 'state';
  return '';
}

function locationValue(profile, field) {
  const id = (profile && profile.identity) || {};
  const key = normalizeQuestion((field && field.label) || '');
  const city = id.based_city || '';
  const kind = locationOptionKind(field);
  if (kind === 'country') return id.country || 'United States';
  if (kind === 'state') return id.based_state || '';
  if (/state/.test(key) && /city|resid|located/.test(key)) {
    const state = id.based_state || '';
    if (city && state) return `${city}, ${state}`;
    return city || state;
  }
  return city;
}

function workFromValue(profile) {
  const id = (profile && profile.identity) || {};
  const city = id.based_city || '';
  const st = id.based_state_code || id.based_state || '';
  if (city && st) return `${city}, ${st}`;
  return city || st;
}

function isWorkFromField(field) {
  const key = normalizeQuestion((field && field.label) || '');
  if (/intend to work/.test(key)) return true;
  if (/from where do you/.test(key) && /work/.test(key)) return true;
  if (/where will you (be )?work(ing)? from/.test(key)) return true;
  if (/remote work(ing)? location/.test(key) && /city/.test(key)) return true;
  return false;
}

function isSponsorshipField(field) {
  const key = fieldBlob(field);
  if (/will you now or in the future (need|require)/.test(key)) return true;
  if (/require(s|d)? (authorization|sponsorship|a visa|visa sponsorship)/.test(key)) return true;
  if (/need(s|ed)? (an? )?(employer )?(to )?(sponsor|authorization|visa)/.test(key)) return true;
  return /sponsor|work visa|work permit/.test(key);
}

function isUsCitizenStatusField(field) {
  const key = fieldBlob(field);
  if (/country of citizenship|citizenship country/.test(key)) return false;
  if (isSponsorshipField(field)) return false;
  return /\bcitizen\b|green card|permanent resident|work authorization status/.test(key);
}

function isAuthorizedField(field) {
  const key = fieldBlob(field);
  if (isSponsorshipField(field)) return false;
  if (
    /\b(canada|uk|united kingdom|australia|eu\b|europe|mexico|india)\b/.test(key) &&
    !/\b(united states|\bus\b|u\.s\.|usa)\b/.test(key)
  ) {
    return false;
  }
  return /authorized|legally.*(work|eligible)|work in the (united states|\bus\b|location)/.test(key);
}

function isForeignWorkAuthField(field) {
  const key = fieldBlob(field);
  return (
    /authorized|legally.*work/.test(key) &&
    /\b(canada|uk|united kingdom|australia)\b/.test(key) &&
    !/\b(united states|\bus\b|u\.s\.|usa)\b/.test(key)
  );
}

function isOnsiteOfficeField(field) {
  const key = fieldBlob(field);
  if (/interview|take-home|codesignal|comfortable moving forward/.test(key)) return false;
  return /in-?office|hybrid work|days per week|on-?site|work from the office|come into the office|able to (do this|commit to this schedule)/.test(
    key
  );
}

function isLocalMetroField(field) {
  const key = fieldBlob(field);
  return (
    /currently located in|are you (currently )?(located|based) in|located in the bay/.test(key) &&
    /bay area|palo alto|san francisco|toronto|new york|\bnyc\b|london/.test(key)
  );
}

function isHearAboutField(field) {
  const key = normalizeQuestion((field && field.label) || '');
  if (/how did you hear|where did you hear|hear about (us|this|the)\b/.test(key)) return true;
  if (!isInstructionLabel(field && field.label) && !/check all that apply|select all that apply/.test(key)) {
    return false;
  }
  const opts = optionLabels(field).join(' ').toLowerCase();
  return /linkedin|indeed|angel ?list|recruiter|job board|career fair|glassdoor/.test(opts);
}

function hearAboutValue(field) {
  const opts = optionLabels(field);
  const hit = opts.find((o) => /linkedin/i.test(o));
  return hit || 'LinkedIn';
}

function isExperienceYesNo(field) {
  const key = fieldBlob(field);
  const label = String((field && field.label) || '');
  if (LLM_RE_LOCAL.test(label)) return false;
  if (!/^(are you|do you|have you|will you|would you|can you)/.test(key) && !/\?/.test(label)) return false;
  return /react|javascript|typescript|frontend|production|startup|years of|proficiency|claude code|comfortable completing|take-home|worked at a startup/.test(
    key
  );
}

const LLM_RE_LOCAL =
  /\b(cover letter|in your own words|tell us\b|describe\b|please (share|describe|explain|tell)|proud of|what interests you)\b/i;

function isYesNoWidget(field) {
  const opts = optionLabels(field);
  if (opts.filter((o) => /^(yes|no)$/i.test(o)).length >= 2) return true;
  const t = String((field && field.type) || '').toLowerCase();
  if (t !== 'checkbox') return false;
  if (opts.length <= 1) return true;
  return opts.every(looksBooleanOption);
}

function leftoverClosedChoice(field, intended, choice) {
  if (!isClosedChoiceField(field) || isOptionalEmptyField(field)) return false;
  if (choice && choice.option) return false;
  return true;
}

function isRemotePlanField(field) {
  const key = fieldBlob(field);
  return /work remotely|plan to work remote/.test(key) && !/city|state of/.test(key);
}

function isOrientationField(field) {
  return /sexual orientation|lgbtq|\blgbt\b|\bsogi\b|sexual identity/.test(fieldBlob(field));
}

function isTransgenderField(field) {
  return /transgender/.test(fieldBlob(field));
}

function isGenderField(field) {
  if (isTransgenderField(field) || isOrientationField(field)) return false;
  return /\bgender\b|\bsex\b|nonbinary/.test(fieldBlob(field));
}

function isEthnicityField(field) {
  if (isRaceOnlyField(field)) return true;
  return /hispanic|latino|ethnicit|\brace\b/.test(fieldBlob(field));
}

function isVeteranField(field) {
  return /veteran/.test(fieldBlob(field));
}

function isDisabilityField(field) {
  return /disabilit/.test(fieldBlob(field));
}

function isBackgroundField(field) {
  return /background (check|screen)|acknowledge/.test(fieldBlob(field));
}

function isSmsField(field) {
  return /sms|text messages?|consent to receive/.test(fieldBlob(field));
}

function isTermsField(field) {
  const key = fieldBlob(field);
  if (isSmsField(field) || isBackgroundField(field) || isConsentField(field)) return false;
  return /terms and conditions|privacy policy|i agree to the terms|i have read and agree|accept the terms/.test(key);
}

function isConsentField(field) {
  if (isSmsField(field)) return false;
  return looksLikeConsent(field);
}

function consentValue(field, profile) {
  const wantYes = !profile || !profile.work || profile.work.interview_recording_consent !== false;
  const opts = ((field && field.options) || []).map((o) => String(o || '').trim()).filter(Boolean);
  if (!wantYes) {
    const no = opts.find((o) => /opt out|do not consent|unrecorded|^\s*no\s*$/i.test(o));
    return no || 'No';
  }
  const yesNo = opts.find((o) => /^yes$/i.test(o));
  if (yesNo) return yesNo;
  const agree = opts.find(
    (o) => /i agree|i consent|acknowledge|i have read|affirmative/i.test(o) && !/opt out|do not|don'?t/i.test(o)
  );
  if (agree) return agree;
  return opts.find((o) => /^yes\b/i.test(o)) || (isYesNoWidget(field) ? 'Yes' : 'I agree');
}

function isGpaField(field) {
  const key = fieldBlob(field);
  return /\bgpa\b|grade point/.test(key) && !/scale|out of/.test(key);
}

function isGpaScaleField(field) {
  const key = fieldBlob(field);
  return (/\bgpa\b|grade point/.test(key) && /scale|out of/.test(key)) || /gpa scale/.test(key);
}

function isHonorsField(field) {
  const key = fieldBlob(field);
  return /\bhonors?\b/.test(key) && !/latin|summa|magna|cum laude/.test(key);
}

function isSalaryHistoryField(field) {
  const key = normalizeQuestion((field && field.label) || '');
  return /salary history|previous compensation|past salary|prior (salary|compensation|pay)|last compensation/.test(key);
}

function termsValue(field) {
  const opts = ((field && field.options) || []).map((o) => String(o || '').trim()).filter(Boolean);
  const prefer = ['I agree', 'I acknowledge', 'I accept', 'Yes'];
  for (const p of prefer) {
    if (opts.some((o) => o.toLowerCase().includes(p.toLowerCase()))) {
      return opts.find((o) => o.toLowerCase().includes(p.toLowerCase()));
    }
  }
  return opts[0] || 'Yes';
}

function isDegreeYesNo(field) {
  const key = fieldBlob(field);
  return /do you have .{0,80}degree|bsc or msc|equivalent (technical )?experience/.test(key);
}

function isChoiceWidget(field) {
  if (!field) return false;
  const t = String(field.type || '').toLowerCase();
  return Boolean(
    field.select ||
      field.reactSelect ||
      t === 'combobox' ||
      t === 'listbox' ||
      t === 'select' ||
      (field.options && field.options.length)
  );
}

function isDegreeLevelField(field) {
  if (isDegreeYesNo(field)) return false;
  const key = fieldBlob(field);
  if (/field of study|major|discipline|school|university|college/.test(key)) return false;
  if (/\b(highest )?(degree|education level|level of education|highest education|qualification|academic level)\b/.test(key)) {
    return true;
  }
  return /\beducation\b/.test(key) && isChoiceWidget(field);
}

function isCountryResidenceField(field) {
  if (isPhoneCountryField(field)) return false;
  const key = fieldBlob(field);
  if (/phone/.test(key)) return false;
  return (
    /\bcountry\b/.test(key) ||
    /current residence|country of residence|citizenship|nationality/.test(key)
  );
}

function isPhoneCountryField(field) {
  const key = fieldBlob(field || {});
  if (/^(phone|mobile|telephone|phone number|mobile number)$/.test(key) && !/country|dial|code/.test(key)) {
    return false;
  }
  if (/phone/.test(key) && !/country|dial|code/.test(key)) return false;
  if (field && field.phoneCountry) return true;
  const combo = field && (field.reactSelect || field.type === 'combobox' || field.select);
  return combo && /phone country|country code|dial code/.test(key);
}

function phoneCountryFallbacks(profile) {
  const id = (profile && profile.identity) || {};
  const mail = mailFromProfile(profile || {});
  const named = [id.country, mail.country].filter(
    (c) => c && /[a-z]/i.test(String(c)) && !/^\+?\d+$/.test(String(c).trim())
  );
  return uniqLabels([...named, 'United States', 'United States of America', 'USA', 'US', '+1']);
}

function displayName(id) {
  const first = (id && (id.preferred_name || id.first_name)) || '';
  const last = (id && id.last_name) || '';
  const joined = [first, last].filter(Boolean).join(' ').trim();
  return joined || (id && id.legal_name) || null;
}

function identityFromAttrs(field, profile) {
  if (isPolarityWidget(field)) return null;
  const id = (profile && profile.identity) || {};
  const mail = mailFromProfile(profile || {});
  const ac = String((field && field.autocomplete) || '').toLowerCase();
  if (ac === 'given-name' || ac === 'fname') return id.first_name || null;
  if (ac === 'family-name' || ac === 'lname') return id.last_name || null;
  if (ac === 'email' || (field && field.type === 'email')) return id.email || null;
  if (ac === 'tel' && field && !field.phoneCountry) return id.phone || null;
  if (ac === 'country' || ac === 'country-name' || ac === 'cntry-name') return id.country || mail.country || null;
  if (ac === 'address-level2') return mail.city || id.city || null;
  if (ac === 'address-level1') return mail.state || id.state || null;
  if (ac === 'postal-code') return mail.zip || id.zip || null;
  if (ac === 'address-line1' || ac === 'street-address') return mail.line1 || mail.street || null;
  if (ac === 'address-line2') return mail.line2 || null;
  const dom = String((field && (field.domId || field.name)) || '');
  if (/^first[_-]?name$/i.test(dom) || /\.firstName$/i.test(dom)) return id.first_name || null;
  if (/^last[_-]?name$/i.test(dom) || /\.lastName$/i.test(dom)) return id.last_name || null;
  if (/^country$/i.test(dom) && !/phone/i.test(dom)) return id.country || mail.country || null;
  if (/\.city$/i.test(dom)) return mail.city || id.city || null;
  if (/\.region$/i.test(dom) || /\.state$/i.test(dom)) return mail.state || id.state || null;
  if (/\.postalCode$/i.test(dom) || /\.zip$/i.test(dom)) return mail.zip || id.zip || null;
  if (/\.addressLine1$/i.test(dom)) return mail.line1 || mail.street || null;
  if (/\.addressLine2$/i.test(dom)) return mail.line2 || null;
  if (/systemfield_name$/i.test(dom) || /^_?name$/i.test(dom)) return displayName(id);
  if (/^email$/i.test(dom) || /systemfield_email$/i.test(dom)) return id.email || null;
  return null;
}

function identityValue(profile, label, field) {
  const key = normalizeQuestion((field && field.label) || label);
  const id = profile.identity || {};
  const work = profile.work || {};
  const mail = mailFromProfile(profile);
  if (isWorkFromField(field || { label })) return workFromValue(profile);
  if (isLocationField(field || { label })) return locationValue(profile, field || { label }) || null;
  const map = [
    [/^legal name$/, id.legal_name],
    [/full name|^name$/, displayName(id)],
    [/preferred(?:\s+\w+){0,2}\s+name/, isYesNoWidget(field) ? null : id.preferred_name || id.first_name],
    [/first name/, id.first_name],
    [/last name|surname|family name/, id.last_name],
    [/e-?mail/, id.email],
    [/phone|mobile/, field && (isPhoneCountryField(field) || isYesNoWidget(field) || field.type === 'checkbox' || field.type === 'radio') ? null : id.phone],
    [/linkedin/, isYesNoWidget(field) ? null : id.linkedin],
    [/github/, id.github],
    [/portfolio|website|personal site/, id.portfolio],
    [/intend to work|from where do you/, workFromValue(profile)],
    [
      /(\btime ?zone\b|where are you based)/,
      isPolarityWidget(field) || /hubs?|united states|canada|reject|asian.?pacific|not sustainable|if you live in/.test(key)
        ? null
        : id.based_city || null,
    ],
    [/remote work(ing)? location|(state of residence|state).{0,80}(remote|work(ing)? from|based)/, id.based_state || null],
    [/^city$|^town$|mailing city/, mail.city],
    [/^state$|state province|province/, mail.state],
    [/zip|postal/, mail.zip],
    [/address line 2|\bapt\.?\b|apartment|\bsuite\b|\bunit\b|line 2/, mail.line2],
    [/address line 1/, mail.line1],
    [/street|^address$|mailing address|home address|residential/, mail.street || mail.line1],
    [/country|current residence|citizenship|nationality/, mail.country],
    [/relocat/, work.willing_to_relocate === false ? 'No' : 'Yes'],
    [/work remotely|remote (work|role|position)|plan to work remote/, work.remote ? 'Yes' : 'No'],
    [/authorized|legally.*(work|eligible)|work in the united states/, isForeignWorkAuthField(field || { label }) ? 'No' : (work.legally_authorized_to_work_us ? 'Yes' : 'No')],
    [/sponsor|work visa/, work.requires_sponsorship_now_or_future ? 'Yes' : 'No'],
    [/background (check|screen)/, 'Yes'],
    [/sms|text messages?|consent to receive/, 'No'],
    [/terms and conditions|privacy policy|i agree to the terms|i have read and agree/, termsValue(field)],
    [/\bgpa\b|grade point/, isGpaScaleField(field || { label }) ? String(firstEducation(profile).gpa_scale || '4.0') : String(firstEducation(profile).gpa || '')],
    [/\bhonors?\b/, firstEducation(profile).honors ? 'Yes' : 'No'],
    [/do you have .{0,80}degree|bsc or msc|equivalent (technical )?experience/, 'Yes'],
    [/job title|position title|role title|current occupation/, latestJob(profile).title],
    [/who is your .{0,48}employer|(current|previous|most recent) (employer|company)/, /notice period|sponsor|conflict/.test(key) ? null : latestJob(profile).employer],
    [/\breferred\b|\brefer you\b|\bemployee refer\b/, 'No'],
    [/restrictive covenant|non-competition|brand partners|family member|significant other/, 'No'],
    [/\bage range\b|\bcurrent age\b|\bhow old\b|\bwhat is your age\b|^\bage$/, (() => {
      const age = ageFromProfile(profile);
      if (age == null) return null;
      return pickAgeOption(optionLabels(field), age) || ageRangeFallbacks(age)[0] || String(age);
    })()],
    [/sexual orientation|lgbtq|\blgbt\b|\bsogi\b/, orientationWants(profile)[0]],
    [/transgender/, transgenderWants(profile)[0]],
    [/\bgender\b|\bsex\b/, isOrientationField(field || { label }) ? null : genderWants(profile)[0]],
    [/hispanic|latino|ethnicit|\brace\b/, ethnicityWants(profile, field)[0]],
    [/veteran/, veteranWants(profile)[0]],
    [/disability/, disabilityWants(profile)[0]],
  ];
  for (const [re, val] of map) {
    if (re.test(key) && val != null && val !== '') return String(val);
  }
  if (isSalaryHistoryField(field || { label })) return salaryHistoryFromProfile(profile) || null;
  if (/salary|compensation|expected pay|pay requirements/.test(key)) return salaryFromProfile(profile) || null;
  return null;
}

function isEmailField(field) {
  if (field.type === 'email' || String(field.autocomplete || '').toLowerCase() === 'email') return true;
  if (/^email$/i.test(field.domId || field.name || '')) return true;
  const key = normalizeQuestion(field.label);
  return /e-?mail/.test(key) && !/subject/.test(key);
}

function mailValue(field, mail) {
  const key = normalizeQuestion(field.label);
  if (isWorkFromField(field)) return null;
  if (isLocationField(field)) return null;
  if (/e-?mail|web address|url|linkedin|github|portfolio/.test(key)) return null;
  if (/timezone|time zone|where are you based/.test(key)) return null;
  if (/intend to work|from where do you|remote work(ing)? location|work(ing)? from/.test(key)) return null;
  if (/address line 2|apt|apartment|suite|unit|line 2/.test(key)) return mail.line2 || null;
  if (/zip|postal/.test(key)) return mail.zip || null;
  if (/^state$|state of residence|state province|province/.test(key)) {
    if (/remote|work(ing)? from|based/.test(key)) return null;
    return mail.state || null;
  }
  if (/(^|\s)(city|town)(\s|$)/.test(key)) {
    if (/resid|located|based|work from/.test(key) && !/mailing|street|address/.test(key)) return null;
    return mail.city || null;
  }
  if ((/country/.test(key) || /current residence|citizenship|nationality/.test(key)) && !/phone/.test(key)) {
    return mail.country || null;
  }
  if (/address line 1/.test(key)) return mail.line1 || null;
  if (/street|^address$|mailing address|home address|residential/.test(key)) {
    return mail.street || mail.line1 || null;
  }
  return null;
}

function isSalaryField(field) {
  if (isSalaryHistoryField(field)) return false;
  const key = normalizeQuestion(field.label);
  return /salary|compensation|expected pay|pay requirements/.test(key);
}

function isAnticipatedWorkField(field) {
  const key = normalizeQuestion((field && field.label) || '');
  if (/mailing|street|address line|zip|postal/.test(key)) return false;
  if (/anticipat/.test(key) && /location|city|based|work/.test(key)) return true;
  if (/\b(work|working|office) location\b/.test(key)) return true;
  return false;
}

function isReferralFollowUp(field) {
  const key = normalizeQuestion(field.label);
  if (isYesNoWidget(field) && !/name|relationship/.test(key)) return false;
  if (/if yes/.test(key) && /employee|referr|name/.test(key)) return true;
  if (/employee'?s name/.test(key)) return true;
  if (/who referred|referr(?:er|ing).{0,40}name|name of.{0,40}(?:employee|referr)/.test(key)) return true;
  if (/referred by/.test(key) && /name|relationship/.test(key)) return true;
  if (/provide their name/.test(key) && /referr|employee/.test(key)) return true;
  return false;
}

function isReferralYesNo(field) {
  const key = normalizeQuestion(field.label);
  if (isReferralFollowUp(field)) return false;
  return /\breferr|\brefer you|employee refer/.test(key);
}

function isHispanicYesNo(field) {
  const key = fieldBlob(field);
  if (!/hispanic|latino/.test(key)) return false;
  return /are you|do you identify|hispanic\/latino|hispanic or latino/.test(key);
}

function isPlaceholderZero(val) {
  const s = String(val || '').trim();
  if (!s) return true;
  if (/^(select|select one|choose|choose one|pick one|please select|n\/a|\.\.\.)$/i.test(s)) return true;
  const d = s.replace(/[$,\s]/g, '');
  return d === '0' || d === '0.00';
}

function resolveValue(field, { profile, canaryPhrases } = {}) {
  const phrases = Array.isArray(canaryPhrases) ? canaryPhrases.filter(Boolean) : [];
  if (isTightCanaryField(field) && isShortTextField(field) && phrases.length) {
    return String(phrases[0]);
  }
  if (isAnticipatedWorkField(field)) return workFromValue(profile);
  const fromAttrs = identityFromAttrs(field, profile);
  if (fromAttrs) return refuseAddressOnChoice(field, fromAttrs);
  if (isPhoneCountryField(field)) {
    return phoneCountryFallbacks(profile)[0] || 'United States';
  }
  if (isEmailField(field)) return (profile.identity && profile.identity.email) || null;
  if (isAnticipatedWorkField(field)) return workFromValue(profile);
  if (isInUsField(field)) return 'Yes';

  const { q, value, contradicted } = confirmedOrFactValue(field, profile);
  if (contradicted) return null;
  if (value != null && String(value).trim() !== '') {
    if (q && q.kind === 'consent') return consentValue(field, profile);
    const extras = fillOpts(field, profile || {}).fallbacks || [];
    const projected = projectFact(optionLabels(field), value, (q && q.projector) || (q && q.kind), field && field.label, extras);
    if (projected && projected.leftover && !projected.value) return null;
    if (projected && projected.value) return refuseAddressOnChoice(field, projected.value);
    return refuseAddressOnChoice(field, value);
  }
  if (q && q.class && !q.unlabeled && q.kind && q.kind !== 'other') return null;

  if (isThresholdYearsPrompt((field && field.label) || '')) return yesNoAnswer(field.label);
  if (isClosedYesNoPrompt((field && field.label) || '')) return yesNoAnswer(field.label);
  if (isGpaScaleField(field)) return String(firstEducation(profile).gpa_scale || '4.0');
  if (isGpaField(field)) return String(firstEducation(profile).gpa || '') || null;
  if (isHonorsField(field)) return firstEducation(profile).honors ? 'Yes' : 'No';
  if (isTermsField(field)) return termsValue(field);
  if (isReferralFollowUp(field)) return 'N/A';
  if (isReferralYesNo(field)) return 'No';
  if (isHispanicYesNo(field)) {
    const eth = String((profile.eeo && profile.eeo.ethnicity) || '');
    return /hispanic|latino/.test(eth) ? 'Yes' : 'No';
  }
  if (isTransgenderField(field)) return transgenderWants(profile)[0] || 'Yes';
  if (isDegreeYesNo(field)) return 'Yes';
  if (isDegreeLevelField(field)) return firstEducation(profile).degree || null;
  if (isRecentJobTitleField(field)) return latestJob(profile).title || null;
  if (isRecentEmployerField(field)) return latestJob(profile).employer || null;
  if (isUsCitizenStatusField(field) && profile.work && profile.work.us_citizen) return 'US Citizen';
  if (isForeignWorkAuthField(field)) return 'No';
  if (isOnsiteOfficeField(field)) {
    return (profile.work && profile.work.willing_to_relocate) ? 'Yes' : 'No';
  }
  if (/asian.?pacific|asia pacific/.test(normalizeQuestion((field && field.label) || ''))) return 'No';
  if (isLocalMetroField(field)) return 'No';
  if (isExperienceYesNo(field)) {
    if (yearsForLabel(field.label) == null && extractNamedStack(field.label)) return 'No';
    if (yearsForLabel(field.label) != null) return yesNoAnswer(field.label);
    return 'Yes';
  }
  if (/proficien/.test(normalizeQuestion((field && field.label) || '')) && /claude|cursor|copilot/.test(normalizeQuestion((field && field.label) || ''))) {
    return 'Daily — production use';
  }
  if (isRemotePlanField(field)) {
    return (profile.work && profile.work.remote) ? 'Yes' : 'No';
  }
  const mailed = mailValue(field, mailFromProfile(profile));
  if (mailed) return refuseAddressOnChoice(field, mailed);
  return refuseAddressOnChoice(field, identityValue(profile, field.label, field));
}

function fillOpts(field, profile, recipe) {
  const opts = {};
  if (recipe && recipe.selector) opts.selector = recipe.selector;
  if (isYearsCountPrompt((field && field.label) || '')) opts.yearsCount = true;
  let extra = [];
  const key = normalizeQuestion(field.label);
  const mail = mailFromProfile(profile || {});
  if (isPhoneCountryField(field)) extra = phoneCountryFallbacks(profile);
  else if (isAgeRangeField(field)) extra = ageRangeFallbacks(ageFromProfile(profile));
  else if (isWorkFromField(field)) {
    extra = uniqLabels([workFromValue(profile)]);
  } else if (isCountryResidenceField(field)) {
    extra = uniqLabels([
      'US',
      mail.country,
      ...aliasFallbacks(mail.country || 'United States', 'country'),
    ]);
  } else if (/^state$|state province|province/.test(key)) {
    extra = uniqLabels([mail.state, mail.state_code]);
  }   else if (isOrientationField(field)) extra = orientationWants(profile);
  else if (isTransgenderField(field)) extra = transgenderWants(profile);
  else if (isGenderField(field)) extra = genderWants(profile);
  else if (isEthnicityField(field)) extra = ethnicityWants(profile, field);
  else if (isVeteranField(field)) extra = veteranWants(profile);
  else if (isDisabilityField(field)) extra = disabilityWants(profile);
  else if (isTermsField(field)) extra = uniqLabels([termsValue(field), 'I agree', 'I acknowledge', 'Yes']);
  else if (isConsentField(field)) extra = uniqLabels([consentValue(field, profile), 'I agree', 'I consent', 'Yes']);
  else if (isHonorsField(field)) extra = firstEducation(profile).honors ? ['Yes', 'with honors'] : ['No'];
  else if (isBackgroundField(field)) extra = ['I acknowledge', 'I agree', 'I consent', 'Yes'];
  else if (isDegreeYesNo(field)) extra = ['Yes', 'equivalent'];
  else if (isDegreeLevelField(field)) {
    extra = uniqLabels([
      firstEducation(profile).degree,
      ...aliasFallbacks(firstEducation(profile).degree || "Bachelor's", 'degree'),
    ]);
  }
  else if (isUsCitizenStatusField(field) && profile.work && profile.work.us_citizen) {
    extra = ['US Citizen', 'U.S. Citizen', 'Citizen', 'United States'];
  }
  else if (isSponsorshipField(field)) {
    extra = (profile.work && profile.work.requires_sponsorship_now_or_future)
      ? ['Yes', 'I will need sponsorship']
      : ['No', 'I will not need sponsorship', 'No, I will not need sponsorship'];
  } else if (isAuthorizedField(field) || isRemotePlanField(field) || isOnsiteOfficeField(field) || isLocalMetroField(field) || isForeignWorkAuthField(field) || isExperienceYesNo(field)) {
    extra = ['Yes', 'No'];
  } else if (isHearAboutField(field)) {
    extra = uniqLabels([hearAboutValue(field), 'LinkedIn']);
  } else if (isLocationField(field)) {
    extra = uniqLabels([
      locationValue(profile, field),
      workFromValue(profile),
      ((profile && profile.identity) || {}).country || '',
    ]);
  }
  if (extra.length) opts.fallbacks = extra;
  return opts;
}

function widgetShape(field) {
  return widgetShapeName(field);
}

function questionKey(field) {
  return clusterDedupeKey(field);
}

function preferInventoryField(a, b) {
  const score = (f) => {
    let n = 0;
    if (f.magnetState === 'green') n += 8;
    if ((f.options || []).length) n += 3;
    if (f.label && !placeholderOption(f.label) && !isGenericLabel(f.label) && !isInstructionLabel(f.label)) n += 4;
    if (f.reactSelect || f.select) n += 2;
    if (f.value) n += 1;
    return n;
  };
  return score(a) >= score(b) ? a : b;
}

function dedupInventoryFields(fields) {
  const merged = mergeInventoryClusters(fields);
  const byKey = new Map();
  const extras = [];
  for (const f of merged) {
    const shaped = f.shape && f.shape.family ? f : { ...f, shape: shapeFromField(f) };
    const key = questionKey(shaped);
    if (!key) {
      if ((shaped.options || []).length >= 2) extras.push(shaped);
      else if (!placeholderOption(shaped.label) && !isInstructionLabel(shaped.label)) extras.push(shaped);
      continue;
    }
    const prev = byKey.get(key);
    byKey.set(key, prev ? preferInventoryField(prev, shaped) : shaped);
  }
  return [...byKey.values(), ...extras];
}

function pickBestFrame(withFields) {
  const scored = withFields.map((r) => {
    const n = ((r && r.fields) || []).length;
    return { r, n };
  });
  scored.sort((a, b) => b.n - a.n);
  return scored[0] && scored[0].r;
}

function fpFor(field) {
  const family = (field && field.shape && field.shape.family) || widgetFamily(field);
  return fingerprint({ fieldKind: family, widgetShape: family });
}

function questionMeta(field) {
  try {
    const q = classifyQuestion(field);
    return { qClass: q.class || '', qKind: q.kind || '', unlabeled: Boolean(q.unlabeled) };
  } catch (_) {
    return { qClass: '', qKind: '', unlabeled: false };
  }
}

function fillTrace(result, chain) {
  return {
    ok: Boolean(result && result.ok),
    skipped: result && result.skipped,
    reason: result && result.reason,
    strategy: result && result.strategy,
    value: result && result.value,
    chain: Array.isArray(chain) ? chain.filter(Boolean) : [],
  };
}

function fillChain(field, fp, tweaks = {}) {
  let chain = chainFor(fp).filter((s) => s !== 'date_mask');
  if (field.reactSelect || widgetShape(field) === 'react_select') {
    chain = ['react_select', ...chain.filter((s) => s !== 'react_select')];
  }
  if (widgetShape(field) === 'combobox') {
    chain = ['combobox', ...chain.filter((s) => s !== 'combobox')];
  }
  if (widgetShape(field) === 'native_select' || field.select || String((field && field.tag) || '').toLowerCase() === 'select') {
    chain = ['select_value', 'native_value', ...chain.filter((s) => s !== 'select_value' && s !== 'native_value')];
  }
  if (tweaks.salary) {
    chain = [
      'input_events',
      'native_value',
      ...chain.filter((s) => s !== 'input_events' && s !== 'native_value'),
    ];
  }
  if (looksLikeDateFill(field, tweaks)) {
    chain = ['date_mask', ...chain.filter((s) => s !== 'date_mask')];
  }
  return chain;
}

async function driveField(wc, field, value, ctx = {}) {
  const {
    chain,
    opts = {},
    recipe,
    allowSavedRun,
    force,
    steps,
    runSource,
    onNote,
    recipeOnly,
  } = ctx;
  const label = field.label || '';
  const fillOptsMerged = { ...opts, force: Boolean(force) };
  if (runSource) {
    const result = await evalFirstOk(wc, executeRunScript(field.id, runSource, fillOptsMerged.selector));
    return result || { ok: false, reason: 'missing' };
  }
  if (allowSavedRun && recipeRunOk(recipe)) {
    onNote && onNote('Running saved script for ' + (label || field.id));
    const result = await evalFirstOk(
      wc,
      executeRunScript(field.id, recipe.run.source, (recipe && recipe.selector) || fillOptsMerged.selector)
    );
    if (result && result.ok) return result;
  }
  const explicit = Array.isArray(steps) && steps.length ? steps : null;
  const stepList = explicit || (recipe && recipe.steps);
  const split = splitRecipeSteps(stepList);
  const dance = split.dance;
  let poke = split.poke;
  if (poke === 'date_mask' && !looksLikeDateFill(field, { value })) poke = '';
  const preferSteps = dance.length && recipeDanceReady(recipe, explicit, field);
  const chainHead = Array.isArray(chain) && chain.length ? chain[0] : 'native_value';
  const paceText =
    wantsPaceType(field, value, wc, ctx) && (chainHead === 'native_value' || chainHead === 'input_events');
  let result = null;
  const stepOpts = { ...fillOptsMerged, label };
  if (preferSteps) {
    result = await evalFirstOk(wc, runStepsScript(field.id, dance, value, stepOpts));
    if (result && result.ok) return result;
  }
  if (poke && !(paceText && (poke === 'native_value' || poke === 'input_events'))) {
    result = await evalFirstOk(
      wc,
      fillAndVerifyScript(field.id, String(value), [poke], label, fillOptsMerged)
    );
    if (result && result.ok) return result;
  }
  if (recipeOnly) return result || { ok: false, reason: 'missing' };
  if (paceText) {
    const paced = await typePaceField(wc, field, value, ctx.tab);
    if (paced && paced.ok) return paced;
  }
  result = await evalFirstOk(
    wc,
    fillAndVerifyScript(field.id, String(value), chain || ['native_value', 'input_events'], label, fillOptsMerged)
  );
  if ((!result || !result.ok) && dance.length && !preferSteps) {
    result = await evalFirstOk(wc, runStepsScript(field.id, dance, value, stepOpts));
    if (result) result.stepsFailed = !result.ok;
  }
  return result || { ok: false, reason: 'missing' };
}

async function typeEssay(wc, field, value, tab) {
  const max = Number(field && (field.maxlength || field.maxLength)) || 0;
  let text = String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (max > 0 && text.length > max) text = text.slice(0, max);
  if (!wc || !field || !field.id) return { ok: false, reason: 'missing' };
  if (!text) return { ok: true, strategy: 'type_pace', value: '' };
  if (typeof wc.sendInputEvent !== 'function') return { ok: false, reason: 'no-input' };
  throwIfAborted(tab);
  if (typeof wc.focus === 'function') {
    try {
      wc.focus();
    } catch (_) {}
  }
  const prep = await evalFirstOk(wc, prepareEssayTypeScript(field.id));
  if (prep && prep.reason === 'not-text') return prep;
  if (!prep || !prep.ok) return prep || { ok: false, reason: 'missing' };
  let restorePause = false;
  try {
    const prior = await evalFirstOk(wc, '(() => ({ ok: true, paused: window.__magnetHarvestPause === true }))()');
    restorePause = Boolean(prior && prior.paused);
  } catch (_) {}
  await evalAllFrames(wc, harvestPauseScript(true));
  try {
    await typeTextEvents(wc, text, {
      getWpm: getEssayWpm,
      signal: tab && tab.fillAbort && tab.fillAbort.signal,
    });
  } catch (err) {
    if (isFillCancelled(err)) throw fillCancelledError();
    throw err;
  } finally {
    try {
      await evalAllFrames(wc, harvestPauseScript(restorePause));
    } catch (_) {}
  }
  return { ok: true, strategy: 'type_pace', value: text };
}

async function typePaceField(wc, field, value, tab) {
  const paced = await typeEssay(wc, field, value, tab);
  if (!paced || !paced.ok) return paced;
  const got = await evalFirstOk(wc, readFieldScript(field.id));
  const have = typeof got === 'string' ? got : '';
  if (valuesEqual(String(value), have, field)) {
    return { ok: true, strategy: 'type_pace', value: have || paced.value };
  }
  return { ok: false, reason: 'unverified', strategy: 'type_pace', value: have };
}

function reviewCancelledError() {
  const err = new Error('review cancelled');
  err.cancelled = true;
  return err;
}

function isReviewCancelled(err) {
  return Boolean(err && err.cancelled);
}

function attachReviewAbort(tab) {
  if (tab && tab.reviewAbort) {
    try {
      tab.reviewAbort.abort();
    } catch (_) {}
  }
  const ac = new AbortController();
  if (tab) {
    tab.reviewAbort = ac;
    tab.reviewCancelMode = '';
  }
  return ac;
}

function cancelReview(tab, opts = {}) {
  if (!tab || !tab.reviewAbort) return { ok: false, error: 'not-reviewing' };
  tab.reviewCancelMode = opts.stop ? 'stop' : 'essay';
  try {
    tab.reviewAbort.abort();
  } catch (_) {}
  return { ok: true, mode: tab.reviewCancelMode };
}

function fillCancelledError() {
  const err = new Error('fill cancelled');
  err.cancelled = true;
  return err;
}

function isFillCancelled(err) {
  return Boolean(err && err.cancelled);
}

function attachFillAbort(tab) {
  if (tab && tab.fillAbort && tab.fillAbort.signal && !tab.fillAbort.signal.aborted) {
    return tab.fillAbort;
  }
  if (tab && tab.fillAbort) {
    try {
      tab.fillAbort.abort();
    } catch (_) {}
  }
  const ac = new AbortController();
  if (tab) {
    tab.fillAbort = ac;
    if (tab.fillCancelRequested) {
      try {
        ac.abort();
      } catch (_) {}
    }
  }
  return ac;
}

function throwIfAborted(tab) {
  if (tab && tab.fillAbort && tab.fillAbort.signal.aborted) throw fillCancelledError();
}

function cancelFill(tab) {
  if (!tab) return { ok: false, error: 'no-tab' };
  tab.fillCancelRequested = true;
  tab.skipDraftCommit = true;
  if (tab.fillAbort) {
    try {
      tab.fillAbort.abort();
    } catch (_) {}
  }
  if (tab.reviewAbort) cancelReview(tab, { stop: true });
  if (tab.fieldChatAbort) {
    try {
      tab.fieldChatAbort.abort();
    } catch (_) {}
  }
  return { ok: true };
}

function spawnReview(payload, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnNode(path.join(__dirname, 'fill-review.js'), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let settled = false;
    let timer = null;
    const signal = opts.signal;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      finish(reject, reviewCancelledError());
    };
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      finish(reject, new Error('fill-review timed out'));
    }, 90000);
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
    }
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => {
      if (signal && signal.aborted) return finish(reject, reviewCancelledError());
      if (code !== 0) return finish(reject, new Error(err || `fill-review exit ${code}`));
      try {
        finish(resolve, JSON.parse(out));
      } catch {
        finish(reject, new Error('fill-review bad json: ' + out.slice(0, 400)));
      }
    });
    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (_) {}
  });
}

function optionTexts(field) {
  return ((field && field.options) || [])
    .map((o) => String((o && (o.text || o.label || o.value)) || o).trim())
    .filter(Boolean);
}

function guessAskValue(field) {
  const opts = optionTexts(field);
  return (
    opts.find((t) => /^(yes|i consent|i agree|consent)$/i.test(t)) ||
    opts.find((t) => /^yes\b/i.test(t)) ||
    ''
  );
}

function fieldForAsk(ask, fields) {
  const list = fields || [];
  if (ask && ask.id) {
    const hit = list.find((f) => f.id === ask.id);
    if (hit) return hit;
  }
  const q = String((ask && ask.question) || '').toLowerCase();
  if (!q) return null;
  return list.find((f) => {
    const lab = String(f.label || '').toLowerCase();
    if (!lab) return false;
    if (q.includes('brighthire') && lab.includes('brighthire')) return true;
    if (q.includes('interview recording') && (lab.includes('brighthire') || lab.includes('recording'))) return true;
    const tokens = lab
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 5)
      .slice(0, 5);
    return tokens.length >= 2 && tokens.filter((w) => q.includes(w)).length >= 2;
  });
}

function isPreferenceAsk(ask, field) {
  const blob = `${(ask && ask.question) || ''} ${(ask && ask.why) || ''} ${(field && field.label) || ''}`.toLowerCase();
  return /consent|opt-?in|brighthire|whatsapp|sms|recording|yes or no/.test(blob);
}

function promoteAsksToFills(asks, fills, fields) {
  const nextFills = [...(fills || [])];
  const leftover = [];
  for (const a of asks || []) {
    const field = fieldForAsk(a, fields);
    if (!field || nextFills.some((f) => f.id === field.id) || !isPreferenceAsk(a, field)) {
      if (a) leftover.push(a);
      continue;
    }
    nextFills.push({
      id: field.id,
      value: guessAskValue(field),
      reason: a.why || a.question || '',
      label: field.label || a.question || field.id,
      accepted: false,
    });
  }
  return { fills: nextFills, asks: leftover };
}

function decorateFills(fills, fields) {
  const list = Array.isArray(fields) ? fields : [];
  return (fills || []).map((f) => {
    const field = list.find((row) => row.id === f.id);
    const g = field ? reviewGate(field, { afterRetry: true }) : {};
    const steps = Array.isArray(f.steps) && f.steps.length ? f.steps : fillStepsFor(field);
    return {
      ...f,
      label: (field && field.label) || f.label || f.id,
      gate: f.gate || g.reason || '',
      steps,
      type: f.type || (field && field.type),
      options: f.options || (field && field.options) || [],
      shape: f.shape || (field && field.shape),
      accepted: false,
    };
  });
}

function decorateRecipes(recipes, fields) {
  const list = Array.isArray(fields) ? fields : [];
  return (recipes || []).map((r, i) => {
    const field = list.find((row) => row.id === r.field_id || row.id === r.id);
    return {
      ...r,
      id: r.id || r.field_id || `recipe-${i}`,
      label: (field && field.label) || r.label || r.field_id || r.id,
      accepted: false,
      dismissed: false,
    };
  });
}

function decorateRuns(runs, fields) {
  const list = Array.isArray(fields) ? fields : [];
  return (runs || []).map((r) => {
    const field = list.find((row) => row.id === r.id);
    return {
      ...r,
      label: (field && field.label) || r.label || r.id,
    };
  });
}

function pendingReview(tab) {
  const review = tab && tab.review;
  if (!review) return false;
  const fills = (review.fills || []).some((f) => !f.accepted && !f.dismissed);
  const asks = (review.asks || []).some((a) => !a.answered);
  const runs = (review.runs || []).some((r) => !r.accepted && !r.dismissed);
  return fills || asks || runs;
}

function focusedStaticField(tab) {
  const id = tab && tab.focusedFieldId;
  if (!id) return null;
  return (tab.debugFields || []).find((f) => f.id === id && f.route === 'static') || null;
}

function isEssayableChatField(field) {
  if (!field) return false;
  if (field.route === 'needs_llm') return true;
  if (field.route === 'employment') return false;
  if (field.phoneCountry) return false;
  const t = String(field.type || '').toLowerCase();
  if (['checkbox', 'radio', 'file', 'hidden', 'submit', 'button'].includes(t)) return false;
  if (field.select || t === 'select') return false;
  if ((field.options || []).length >= 2) return false;
  if (field.reactSelect) return false;
  const label = String(field.label || '');
  if (isClosedFactPrompt(label)) return false;
  if (/\b(phone|email|linkedin|github|website|salary|first name|last name|zip|postal)\b/i.test(label)) return false;
  return Boolean(
    field.tag === 'textarea' ||
      t === 'textarea' ||
      field.contenteditable ||
      t === 'text' ||
      t === 'search' ||
      t === '' ||
      Number(field.maxlength) >= 200
  );
}

function applyEssayOverride(tab, found, text) {
  if (!wantsEssayOverride(text)) return false;
  const id = tab && tab.chatTarget && tab.chatTarget.id;
  if (!id) return false;
  const lists = [(found && found.debugFields) || [], (found && found.essayFields) || [], (tab && tab.debugFields) || []];
  let field = null;
  for (const list of lists) {
    const hit = list.find((f) => f && f.id === id);
    if (hit) {
      field = hit;
      break;
    }
  }
  if (!field) return false;
  field.route = 'needs_llm';
  if (tab.chatTarget) tab.chatTarget.route = 'needs_llm';
  for (const list of lists) {
    const row = list.find((f) => f && f.id === id);
    if (row) row.route = 'needs_llm';
  }
  if (found && Array.isArray(found.essayFields) && !found.essayFields.some((f) => f.id === id)) {
    found.essayFields.push(field);
  }
  if (found && Array.isArray(found.debugFields)) {
    const row = found.debugFields.find((f) => f.id === id);
    if (row) row.route = 'needs_llm';
  }
  try {
    if (field.label) learnRecipe({ label: field.label, route: 'needs_llm' });
  } catch (_) {}
  return true;
}

function applyMirrorSave(tab, payload) {
  if (!tab) return { ok: false, error: 'no-tab' };
  const id = payload && (payload.id || payload.fieldId);
  if (!id) return { ok: false, error: 'no-field' };
  const value = payload && payload.value != null ? String(payload.value) : '';
  tab.essaySession = tab.essaySession && typeof tab.essaySession === 'object' ? tab.essaySession : { fields: [] };
  if (!Array.isArray(tab.essaySession.fields)) tab.essaySession.fields = [];
  let row = tab.essaySession.fields.find((f) => f.id === id);
  if (!row) {
    row = { id, label: (payload && payload.label) || '', origin: 'applicant' };
    tab.essaySession.fields.push(row);
  }
  row.final = value;
  row.origin = 'applicant';
  if (payload && payload.label) row.label = payload.label;
  try {
    const { recordEssay } = require('./essay-log');
    recordEssay({
      ...row,
      company: tab.meta && tab.meta.name,
      url: tab.meta && tab.meta.url,
    });
  } catch (err) {
    console.warn('[magnet] essay log:', (err && err.message) || err);
  }
  return { ok: true, field: row };
}

async function applyStoredAge(wc, tab) {
  const profile = loadProfile();
  const age = ageFromProfile(profile);
  if (!age || !wc) return [];
  const fields = ((tab && tab.debugFields) || []).filter((f) => isAgeRangeField(f));
  const filled = [];
  for (const field of fields) {
    const live = await rematchPageField(wc, field);
    const raw = resolveValue(live, { profile });
    const extras = fillOpts(live, profile).fallbacks || [];
    const choice = pickClosestOption(live.options, raw, extras, live.label);
    const intended = (choice && choice.option) || raw;
    if (!intended) continue;
    const result = await driveField(wc, live, intended, {
      chain: ['label_click', 'native_value', 'input_events'],
      opts: { ...fillOpts(live, profile), fallbacks: uniqLabels([intended, raw, ...extras]), force: true },
      force: true,
    });
    if (result && result.ok) {
      await evalFirstOk(wc, paintScript(live.id, 'green'));
      live.magnetState = 'green';
      live.intended = intended;
      live.current = result.value || intended;
      field.magnetState = 'green';
      field.intended = intended;
      field.current = live.current;
      filled.push({ id: live.id, label: live.label || field.label, value: intended });
    }
  }
  return filled;
}

function harvestedAge(applied) {
  const row = (applied || []).find((a) => a.path === 'identity.age');
  return row ? row.value : null;
}

function phoneTail(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function persistFieldFact(field, value) {
  const label = (field && field.label) || '';
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return [];
  const updates = [];
  if (isAgeRangeField(field)) {
    const age = parseAgeFromText(raw) || (/^\d{2}$/.test(raw) ? Number(raw) : null);
    if (Number.isInteger(age) && age >= 18 && age <= 80) updates.push({ path: 'identity.age', value: age });
  }
  if (isYearsCountPrompt(label)) {
    const skill = matchSkill(label);
    const id = (skill && skill.id) || extractNamedStack(label);
    const n = Number(String(raw).replace(/[^\d.-]/g, ''));
    if (id && Number.isInteger(n) && n >= 0 && n <= 40) updates.push({ path: `skills.${id}`, value: n });
  }
  if (/phone|mobile|telephone/i.test(label) && /^\+?\d[\d\s().-]{6,}$/.test(raw)) {
    const profile = loadProfile();
    const identity = (profile && profile.identity) || {};
    const current = phoneTail(identity.phone_national || identity.phone);
    const incoming = phoneTail(raw);
    if (!current || !incoming || current === incoming) {
      updates.push({ path: 'identity.phone', value: raw.replace(/\s+/g, ' ').trim() });
    }
  }
  if (isSalaryPrompt(label) || isSalaryField(field)) {
    const n = Number(String(raw).replace(/[$,]/g, ''));
    if (Number.isInteger(n) && n >= 10000 && n <= 1000000) {
      const hist = /\b(histor|current salary|currently make|last salary)\b/i.test(label) || isSalaryHistoryField(field);
      const profile = loadProfile();
      const comp = (profile && profile.work && profile.work.compensation) || {};
      const current = hist ? comp.history_usd : comp.target_usd;
      if (current == null || Number(current) === n) {
        updates.push({
          path: hist ? 'work.compensation.history_usd' : 'work.compensation.target_usd',
          value: n,
        });
      }
    }
  }
  return applyUpdates(updates);
}

function rememberAnswer(field, value, extra = {}) {
  const catalog = require('./question-catalog');
  const explicit = catalog.chosenClass(extra.classId || extra.class || extra.route || '');
  const skip = extra.skip || extra.leaveBlank || explicit === 'skip' || extra.route === 'skip';
  if (skip) {
    if (field && field.label) {
      try {
        learnRecipe({ label: field.label, route: 'skip' });
      } catch (_) {}
    }
    return [];
  }
  const raw = String(value == null ? '' : value).trim();
  const applied = persistFieldFact(field, raw);
  const guessed = classifyQuestion(field);
  let classId = explicit;
  if (!classId && guessed && guessed.class && catalog.classFitsValue(guessed.class, raw, field)) {
    classId = guessed.class;
  }
  if (classId && raw && classId !== 'skip') {
    confirmClass(classId, raw, { source: extra.source || 'accept', label: (field && field.label) || '' });
  }
  if (explicit && catalog.aliasClassId(explicit) && field && field.label) {
    try {
      catalog.learnAlias(explicit, extra.aliasPhrase || field.label);
    } catch (_) {}
  }
  return applied;
}

function profileFactBits(applied) {
  const bits = [];
  for (const row of applied || []) {
    if (row.path === 'identity.age') bits.push(`Stored age ${row.value} on the profile.`);
    if (row.path.startsWith('skills.') && row.path.endsWith('.years')) {
      bits.push(`Stored ${row.path.slice(7, -6)} at ${row.value} years.`);
    }
  }
  return bits;
}

async function evalAllFrames(wc, script) {
  const run = async (contents) => {
    try {
      return await contents.executeJavaScript(script, true);
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) };
    }
  };
  const results = [await run(wc)];
  try {
    for (const frame of wc.mainFrame.frames) {
      results.push(await run(frame));
    }
  } catch (_) {
    /* ignore */
  }
  return results;
}

async function evalFirstOk(wc, script) {
  const results = await evalAllFrames(wc, script);
  const okHit = results.find((r) => r && r.ok);
  if (okHit) return okHit;
  const withFields = results.filter((r) => r && Array.isArray(r.fields) && r.fields.length);
  if (withFields.length === 1) return withFields[0];
  if (withFields.length > 1) return pickBestFrame(withFields) || withFields[0];
  const str = results.find((r) => typeof r === 'string' && r.length);
  if (str != null) return str;
  return results.find((r) => r && !r.error) || results[0];
}

function appendAttempt(row) {
  const entry = { ts: new Date().toISOString(), ...row };
  try {
    const remote = require('./store/remote-log').insert('autofill_attempts', {
      ts: entry.ts,
      url: entry.url || null,
      company: entry.company || null,
      field_count: entry.field_count,
      essays: entry.essays,
      static_ok: entry.static_ok,
      static_total: entry.static_total,
      proposed: entry.proposed,
      accepted: entry.accepted,
      harvested: entry.harvested,
      save_without_verify: entry.save_without_verify,
      essays_only: entry.essays_only,
      field_id: entry.field_id || entry.fieldId || null,
      label: entry.label || null,
      fields: entry.fields || null,
      extra: entry,
    });
    if (remote) return;
  } catch (err) {
    console.warn('[magnet] attempt log:', (err && err.message) || err);
  }
  const file = path.join(ARCHIVE, 'attempts.jsonl');
  fs.mkdirSync(ARCHIVE, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

function sessionPath(tabId) {
  return path.join(ARCHIVE, `essay-session-${tabId}.json`);
}

function loadSession(tabId) {
  const p = sessionPath(tabId);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return { fields: [] };
}

function saveSession(tabId, data, meta) {
  fs.mkdirSync(ARCHIVE, { recursive: true });
  fs.writeFileSync(sessionPath(tabId), JSON.stringify(data, null, 2));
  try {
    const { recordSession } = require('./essay-log');
    recordSession(data, meta || {});
  } catch (err) {
    console.warn('[magnet] essay log:', (err && err.message) || err);
  }
}

async function invokeEssayTurn(tab, payload, opts = {}) {
  const { mintTabAgent, currentAgentModel } = require('./tab-agent');
  const { CHAT_TOOLS } = require('./chat-tools');
  const client = require('./agent-client');
  if (tab && tab.meta && tab.meta.id) {
    try {
      await mintTabAgent(tab, payload);
    } catch (err) {
      if (err && err.cancelled) throw err;
      console.warn('[magnet] mint tab agent:', err.message || err);
    }
    payload.tabId = String(tab.meta.id);
    payload.agentId = tab.agentId || '';
  }
  const ev = await client.invoke('essay', payload, {
    signal: opts.signal,
    model: currentAgentModel(),
    tools: CHAT_TOOLS.slice(),
    toolSet: 'chat',
    onEvent: opts.onEvent,
  });
  if (ev && ev.cancelled) {
    const err = new Error('fill cancelled');
    err.cancelled = true;
    throw err;
  }
  if (ev && ev.agentId && tab) tab.agentId = ev.agentId;
  return (ev && ev.result) || {};
}

async function fillRowSet(wc, rows, specs, kind, tab) {
  const inv = await evalFirstOk(wc, INVENTORY_SCRIPT);
  const fields = dedupInventoryFields((inv && inv.fields) || []);
  const used = new Set();
  for (const row of rows) {
    for (const spec of specs) {
      const field = fields.find((f) => {
        if (used.has(f.id) || f.value) return false;
        if ((f.type === 'radio' || f.type === 'checkbox') && spec.key !== 'current') return false;
        const key = normalizeQuestion(f.label);
        if (
          kind === 'employment' &&
          /^(first name|last name|full name|email|mobile number|phone|address|city|zip code|postal|country|state)$/.test(
            key
          )
        ) {
          return false;
        }
        return spec.re.test(key);
      });
      if (!field) continue;
      if (spec.key === 'end' && row.current) {
        used.add(field.id);
        continue;
      }
      let value = row[spec.key];
      if (spec.key === 'current') value = row.current ? 'true' : 'false';
      if (value == null || value === '') continue;
      used.add(field.id);
      const fp = fpFor(field);
      const chain = fillChain(field, fp, {
        dates: spec.key === 'start' || spec.key === 'end' || spec.key === 'month' || spec.key === 'year',
        value,
      });
      let result = null;
      if (wantsPaceType(field, value, wc, { tab })) {
        result = await typePaceField(wc, field, value, tab);
      }
      if (!result || !result.ok) {
        result = await evalFirstOk(wc, fillAndVerifyScript(field.id, String(value), chain));
      }
      if (result && result.ok && !result.skipped) {
        recordWin(fp, result.strategy || 'native_value');
      } else if (!result || !result.ok) {
        recordLoss(fp, (result && result.strategy) || 'native_value');
      }
    }
  }
}

async function fillEmployment(wc, onStep, tab) {
  const plan = employmentPlan();
  if (!plan.employment.length) return { ok: true, rows: 0 };
  onStep && onStep('Fill');
  const inv0 = await evalFirstOk(wc, INVENTORY_SCRIPT);
  const hasEmp = ((inv0 && inv0.fields) || []).some((f) =>
    /\b(employer|company name|job title|employment history|work history)\b/i.test(normalizeQuestion(f.label))
  );
  if (!hasEmp) return { ok: true, rows: 0, skipped: 'no-employment-section' };
  for (let i = 0; i < plan.employment.length - 1; i++) {
    const added = await evalFirstOk(wc, ADD_SCRIPT);
    if (!added || !added.ok) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  await fillRowSet(
    wc,
    plan.employment,
    [
      { re: /\b(employer|company name|current employer)\b/, key: 'employer' },
      { re: /\bjob title\b/, key: 'title' },
      { re: /\b(job location|work location|employment location)\b/, key: 'location' },
      { re: /start date|start month|^from$/, key: 'start' },
      { re: /end date|^to$|until/, key: 'end' },
      { re: /currently work|i currently|current role/, key: 'current' },
      { re: /description|responsibilit/, key: 'bullets' },
    ],
    'employment',
    tab
  );
  if (plan.education.length) {
    const inv = await evalFirstOk(wc, INVENTORY_SCRIPT);
    const hasSchool = ((inv && inv.fields) || []).some((f) =>
      /school|university|college/i.test(f.label || '')
    );
    if (hasSchool) {
      await fillRowSet(
        wc,
        plan.education,
        [
          { re: /school|university|college/, key: 'school' },
          { re: /degree|field of study/, key: 'degree' },
          { re: /graduat|end date|year/, key: 'end' },
        ],
        'education',
        tab
      );
    }
  }
  return { ok: true, rows: plan.employment.length };
}

async function retryField(wc, tab, fieldId, flagName, correction) {
  const field = (tab.debugFields || []).find((f) => f.id === fieldId);
  if (!field) return { ok: false, error: 'no-field' };
  const fp = fpFor(field);
  flag(fp, flagName);
  const typed = correction != null ? String(correction).trim() : '';
  if (flagName === 'wrong_value') {
    const q = classifyQuestion(field);
    const landed = valuesEqual(field.intended || '', field.current != null ? field.current : field.value || '', field);
    if (q.class && landed) contradictClass(q.class, { source: 'wrong_value', label: field.label });
  }
  if (flagName === 'wrong_value' && !typed) {
    return { ok: false, open_review: true, fieldId, label: field.label, previous: field.current || field.value || '' };
  }
  if (flagName === 'filled_but_not_touched' && !typed) {
    const recipe = findRecipe({ label: field.label, field });
    return {
      ok: false,
      open_review: true,
      reopen_run: Boolean(recipe && recipe.run && recipe.run.source),
      fieldId,
      label: field.label,
      previous: field.current || field.value || '',
      runSource: recipe && recipe.run && recipe.run.source,
    };
  }
  if (flagName === 'wrong_value' && typed) {
    const profile = loadProfile();
    rememberAnswer(field, typed, { source: 'wrong_value' });
    const recipe = findRecipe({ label: field.label, field });
    const result = await driveField(wc, field, typed, {
      chain: fillChain(field, fp, { value: typed }),
      opts: fillOpts(field, profile, recipe),
      recipe,
      force: true,
    });
    if (result && result.ok) {
      let selector = recipe && recipe.selector;
      try {
        const selRaw = await evalFirstOk(wc, fieldSelectorScript(field.id));
        if (typeof selRaw === 'string' && selRaw.trim()) selector = selRaw.trim();
      } catch (_) {}
      learnNoticePoke(tab, field, typed, result, {
        recipe,
        selector,
        steps: genericReplaySteps(field, typed, result),
      });
      recordWin(fp, result.strategy || 'native_value');
    }
    await evalFirstOk(wc, paintScript(field.id, result && result.ok ? 'green' : 'red'));
    return { ok: Boolean(result && result.ok), learned: true, value: typed, fp, result };
  }
  if (flagName === 'couldnt_add_row') {
    await evalFirstOk(wc, ADD_SCRIPT);
  }
  const profile = loadProfile();
  const value = resolveValue(field, { profile });
  if (value == null || value === '') return { ok: false, error: 'no-value', fp, label: field.label };
  const recipe = findRecipe({ label: field.label, field });
  const result = await driveField(wc, field, value, {
    chain: fillChain(field, fp, { value }),
    opts: fillOpts(field, profile, recipe),
    recipe,
    allowSavedRun: true,
  });
  if (result && result.ok) {
    recordWin(fp, result.strategy || 'native_value');
    await evalFirstOk(wc, paintScript(field.id, 'green'));
  } else {
    recordLoss(fp, (result && result.strategy) || 'native_value');
    await evalFirstOk(wc, paintScript(field.id, 'red'));
  }
  return { ok: Boolean(result && result.ok), fp, result };
}

async function retryReviewField(wc, tab, payload = {}) {
  const fieldId = payload.fieldId;
  const flagName = String(payload.flag || '').trim();
  if (flagName) return retryField(wc, tab, fieldId, flagName, payload.value);
  const field = findReviewField(tab, fieldId, { label: payload.label });
  if (!field) return { ok: false, error: 'no-field' };
  const profile = loadProfile();
  const typed = payload.value != null ? String(payload.value).trim() : '';
  const value = typed || field.intended || resolveValue(field, { profile, canaryPhrases: (tab.jd && tab.jd.findings && tab.jd.findings.canaryPhrases) || [] });
  if (value == null || value === '') return { ok: false, error: 'no-value', label: field.label };
  const fp = fpFor(field);
  const recipe = findRecipe({ label: field.label, field });
  const strategy = String(payload.strategy || '').trim();
  const salary = isSalaryField(field) || isSalaryHistoryField(field) || field.type === 'number';
  const chain =
    strategy && strategy !== 'steps' && strategy !== 'run'
      ? [strategy]
      : fillChain(field, fp, { salary, value });
  const result = await driveField(wc, field, value, {
    chain,
    opts: { ...fillOpts(field, profile, recipe), force: true },
    recipe: strategy && strategy !== 'steps' && strategy !== 'run' ? null : recipe,
    allowSavedRun: !strategy || strategy === 'run',
    steps: strategy === 'steps' ? recipe && recipe.steps : undefined,
    recipeOnly: strategy === 'steps',
    force: true,
  });
  field.intended = value;
  field.current = result && result.value != null ? result.value : field.current;
  field.fill = fillTrace(result, chain);
  if (result && result.ok) {
    recordWin(fp, result.strategy || strategy || 'native_value');
    learnNoticePoke(tab, field, value, result, { recipe });
    field.magnetState = 'green';
    field.residual = '';
    try {
      await evalFirstOk(wc, paintScript(field.id, 'green'));
    } catch (_) {}
  } else {
    recordLoss(fp, (result && result.strategy) || strategy || 'native_value');
    field.magnetState = 'red';
    try {
      await evalFirstOk(wc, paintScript(field.id, 'red'));
    } catch (_) {}
  }
  return { ok: Boolean(result && result.ok), fp, result, strategy: (result && result.strategy) || strategy };
}

async function snapshotPage(wc) {
  const inv = await evalFirstOk(wc, INVENTORY_SCRIPT);
  return {
    href: (inv && inv.href) || (wc.getURL && wc.getURL()),
    fields: (inv && inv.fields) || [],
  };
}

async function syncEssayFinals(wc, session) {
  if (!wc || !session || !session.fields) return session;
  for (const f of session.fields) {
    const val = await evalFirstOk(wc, readFieldScript(f.id));
    if (typeof val === 'string' && val.trim()) f.final = val;
  }
  return session;
}

/** Capture long-form answers the applicant typed that Magnet never drafted. */
async function harvestApplicantEssays(wc, session) {
  const fields = [...((session && session.fields) || [])];
  if (!wc) return { fields };
  const inv = await snapshotPage(wc);
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const field of (inv && inv.fields) || []) {
    if (
      /^(or )?enter manually$/i.test(String(field.label || '').trim()) &&
      (field.tag === 'textarea' || field.contenteditable)
    ) {
      field.label = 'Cover Letter';
    }
    const { route } = classifyField(field);
    if (route !== 'needs_llm') continue;
    const raw = await evalFirstOk(wc, readFieldScript(field.id));
    const val = usefulCurrent(typeof raw === 'string' ? raw : field.value || '');
    if (val.length < 40) continue;
    const existing = byId.get(field.id);
    if (existing) {
      if (!String(existing.final || '').trim()) existing.final = val;
      continue;
    }
    const row = {
      id: field.id,
      label: field.label,
      normalized_key: normalizeQuestion(field.label),
      llm_draft: '',
      final: val,
      origin: 'applicant',
    };
    fields.push(row);
    byId.set(field.id, row);
  }
  return { fields };
}

async function harvestTabAnswers(wc, tab) {
  const meta = (tab && tab.meta) || {};
  const pageFields = [];
  if (wc) {
    try {
      const inv = await snapshotPage(wc);
      for (const field of (inv && inv.fields) || []) {
        let current = field.value || field.current || '';
        try {
          const raw = await evalFirstOk(wc, readFieldScript(field.id));
          if (typeof raw === 'string' && raw.trim()) current = raw;
        } catch (_) {}
        pageFields.push({ ...field, current });
      }
    } catch (err) {
      console.warn('[magnet] harvest snapshot:', (err && err.message) || err);
    }
  }
  const { collectAnswers, recordAnswers } = require('./answer-log');
  const rows = collectAnswers(
    [
      pageFields,
      (tab && tab.debugFields) || [],
      (tab && tab.essaySession && tab.essaySession.fields) || [],
      (tab && tab.answerLog) || [],
    ],
    meta
  );
  if (tab) tab.answerLog = rows;
  recordAnswers(rows, meta);
  return {
    ok: true,
    count: rows.length,
    essays: rows.filter((row) => row.kind === 'essay').length,
    answers: rows,
    url: meta.url || '',
    company: meta.company || meta.name || '',
  };
}

async function processFields(wc, fields, ctx) {
  const { profile, debugFields, essayFields, seen, fill, canaryPhrases, onNote, skipEssays } = ctx;
  for (const field of fields) {
    throwIfAborted(ctx.tab);
    const qk = questionKey(field);
    if (seen.has(field.id) || (qk && seen.has(qk))) continue;
    seen.add(field.id);
    if (qk) seen.add(qk);
    if (isChromeField(field)) {
      debugFields.push({ ...field, route: 'skip', reason: 'chrome', intended: '', magnetState: 'skip', fill: null });
      await evalFirstOk(wc, paintScript(field.id, 'skip'));
      continue;
    }
    if (
      /^(or )?enter manually$/i.test(String(field.label || '').trim()) &&
      (field.tag === 'textarea' || field.contenteditable)
    ) {
      field.label = 'Cover Letter';
    }
    let { route, reason } = classifyField(field);
    if (route === 'needs_llm' && isClosedFactPrompt(field.label)) {
      route = 'static';
      reason = 'closed-fact';
    }
    const recipe = findRecipe({ label: field.label, field });
    const options = optionTexts(field);
    const stored = lookupFootprint(field.label, options);
    const taught = stored && stored.source === 'taught' ? answerOnOptions(stored.answer, options) : '';
    let rawIntended = taught || resolveValue(field, { profile, canaryPhrases });
    const extras = fillOpts(field, profile, recipe).fallbacks || [];
    const choice = taught
      ? { option: taught, confidence: 'footprint', reason: 'Reused the answer saved for this question.' }
      : pickClosestOption(field.options, rawIntended, extras, field.label);
    let intended = (choice && choice.option) || rawIntended;
    if (
      choice &&
      isBareBool(choice.option) &&
      rawIntended &&
      !isBareBool(rawIntended) &&
      /(@|https?:|linkedin|github|\d{5,})/i.test(String(rawIntended))
    ) {
      intended = rawIntended;
    }
    if (options.length >= 2 && answerOnOptions(intended, options)) {
      rememberFootprint(field.label, options, answerOnOptions(intended, options), taught ? 'taught' : 'profile');
    }
    const meta = questionMeta(field);
    const row = {
      ...field,
      route,
      reason,
      qClass: meta.qClass,
      qKind: meta.qKind,
      unlabeled: meta.unlabeled,
      profileValue: rawIntended || '',
      intended: intended || '',
      uncertainty:
        choice && choice.option && choice.confidence && choice.confidence !== 'exact'
          ? { intended: rawIntended, picked: choice.option, confidence: choice.confidence, reason: choice.reason }
          : null,
      current: field.userValue || field.value || '',
      prefill: field.prefill || field.value || '',
      userValue: field.userValue || '',
      magnetState: field.magnetState || 'yellow',
      recipeHit: recipe
        ? { label_key: recipe.label_key, match: recipe.match, has_steps: Boolean(recipe.steps), has_run: Boolean(recipe.run) }
        : null,
      fill: null,
    };
    debugFields.push(row);
    if (route === 'skip') {
      await evalFirstOk(wc, paintScript(field.id, 'skip'));
      row.magnetState = 'skip';
      continue;
    }
    if (route === 'needs_llm') {
      essayFields.push(field);
      const ESSAY_PLACEHOLDER = 'Let me think on this…';
      const cur = String(field.value || row.current || '').trim();
      const alreadyBusy = /let me think on this|matching experience/i.test(cur);
      if (fill && !skipEssays && !cur && !alreadyBusy) {
        const fp = fpFor(field);
        const chain = fillChain(field, fp, {});
        const result = await driveField(wc, field, ESSAY_PLACEHOLDER, {
          chain,
          opts: { ...fillOpts(field, profile, recipe), force: true },
          recipe,
          onNote,
          instant: true,
        });
        if (result && result.ok && result.strategy) recordWin(fp, result.strategy);
        row.current = (result && result.value != null ? result.value : ESSAY_PLACEHOLDER) || ESSAY_PLACEHOLDER;
      }
      await evalFirstOk(wc, paintScript(field.id, 'orange'));
      row.magnetState = 'orange';
      continue;
    }
    if (route === 'employment') {
      await evalFirstOk(wc, paintScript(field.id, 'skip'));
      row.magnetState = 'skip';
      continue;
    }
    if (!fill) continue;
    let skipFilled = isChoiceLikeField(field)
      ? hasCommittedChoice(field) && !isSalaryField(field) && !isSalaryHistoryField(field)
      : field.value && !isPlaceholderZero(field.value) && !isSalaryField(field) && !isSalaryHistoryField(field);
    if (skipFilled && (looksContaminated(field) || wantsCheckedYes(field, intended))) skipFilled = false;
    if (skipFilled && intended && !valuesEqual(intended, field.value, field)) skipFilled = false;
    if (skipFilled) {
      await evalFirstOk(wc, paintScript(field.id, 'green'));
      row.magnetState = 'green';
      row.fill = { ok: true, skipped: 'nonempty', value: field.value, chain: [] };
      row.current = field.value;
      continue;
    }
    if (leftoverClosedChoice(field, intended, choice)) {
      await evalFirstOk(wc, paintScript(field.id, 'red'));
      row.route = 'static';
      row.reason = 'needs-infer';
      row.residual = 'needs-infer';
      row.magnetState = 'red';
      row.intended = '';
      row.fill = { ok: false, reason: 'needs-infer', chain: [] };
      continue;
    }
    if (intended == null || intended === '') {
      if (isOptionalEmptyField(field) || !looksRequired(field)) {
        await evalFirstOk(wc, paintScript(field.id, 'skip'));
        row.route = 'skip';
        row.reason = 'optional-empty';
        row.magnetState = 'skip';
        row.fill = { ok: true, skipped: 'optional-empty', chain: [] };
        continue;
      }
      await evalFirstOk(wc, paintScript(field.id, 'red'));
      row.magnetState = 'red';
      row.fill = { ok: false, reason: 'no-value', chain: [] };
      continue;
    }
    if (
      (field.type === 'checkbox' || field.type === 'radio') &&
      /^\s*\$?\d[\d,]*\.?\d*\s*$/.test(String(intended))
    ) {
      continue;
    }
    const fp = fpFor(field);
    const chain = fillChain(field, fp, {
      salary: isSalaryField(field) || isSalaryHistoryField(field) || field.type === 'number',
      value: intended,
    });
    const baseOpts = fillOpts(field, profile, recipe);
    const result = await driveField(wc, field, intended, {
      chain,
      opts: {
        ...baseOpts,
        fallbacks: uniqLabels([intended, rawIntended, ...(baseOpts.fallbacks || [])]),
      },
      recipe,
      allowSavedRun: true,
      onNote,
      tab: ctx.tab,
    });
    row.fill = fillTrace(result, chain);
    row.current = (result && result.value != null ? result.value : field.value) || '';
    if (!row.uncertainty) {
      row.uncertainty = uncertaintyBetween(rawIntended || intended, row.current);
    }
    if (result && result.ok && !result.skipped) {
      recordWin(fp, result.strategy || 'native_value');
      learnNoticePoke(ctx.tab, field, intended, result, { recipe });
      await evalFirstOk(wc, paintScript(field.id, 'green'));
      row.magnetState = 'green';
      if (widgetShape(field) === 'combobox' || field.reactSelect) {
        await new Promise((r) => setTimeout(r, 220));
      }
    } else if (result && result.skipped) {
      await evalFirstOk(wc, paintScript(field.id, 'green'));
      row.magnetState = 'green';
    } else {
      recordLoss(fp, (result && result.strategy) || 'native_value');
      await evalFirstOk(wc, paintScript(field.id, 'red'));
      row.magnetState = 'red';
    }
  }
}

async function hydrateSelectOptions(wc, fields, opts = {}) {
  if (!wc || !fields || !fields.length) return fields;
  const need = fields.filter((f) => {
    if (!isSelectLikeField(f) || ((f.options || []).length >= 2)) return false;
    if (hasCommittedChoice(f)) return false;
    return true;
  });
  if (!need.length) return fields;
  try {
    const results = await evalAllFrames(wc, harvestSelectOptionsScript(need.map((f) => f.id), { open: opts.open === true }));
    const map = {};
    for (const r of results || []) {
      const part = r && r.optionsById;
      if (!part) continue;
      for (const [id, opts] of Object.entries(part)) {
        if (!Array.isArray(opts) || opts.length < 2) continue;
        const owner = fields.find((f) => f.id === id);
        if (looksLikeDialCountryList(opts) && !(owner && (owner.phoneCountry || isPhoneCountryField(owner)))) {
          continue;
        }
        if (!map[id] || map[id].length < opts.length) map[id] = opts;
      }
    }
    for (const f of fields) {
      const opts = map[f.id];
      if (opts && opts.length >= 2) f.options = opts;
    }
  } catch (_) {}
  return fields;
}

async function waitForInventory(wc, minCount, ms = 3500) {
  const start = Date.now();
  let inv = { fields: [] };
  while (Date.now() - start < ms) {
    try {
      inv = await evalFirstOk(wc, INVENTORY_SCRIPT);
      if (((inv && inv.fields) || []).length >= minCount) return inv;
    } catch (_) {
      /* navigation mid-eval */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return inv;
}

async function waitForLoad(wc, ms = 7000) {
  try {
    if (wc && typeof wc.isLoading === 'function' && wc.isLoading()) {
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          try {
            wc.removeListener('did-finish-load', done);
          } catch (_) {}
          resolve();
        };
        const timer = setTimeout(done, ms);
        if (typeof wc.once === 'function') wc.once('did-finish-load', done);
        else done();
      });
    }
  } catch (_) {}
}

async function waitAfterApplyClick(wc, beforeN) {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 250));
  await waitForLoad(wc, 7000);
  const left = Math.max(2500, 8000 - (Date.now() - start));
  return waitForInventory(wc, Math.max(1, beforeN + 1), left);
}

async function waitForPageChange(wc, before, ms = 4500) {
  const beforeHref = String((before && before.href) || '');
  const beforeFp = String((before && before.fp) || '');
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 200));
  await waitForLoad(wc, 7000);
  while (Date.now() - start < ms) {
    try {
      const href = (wc && wc.getURL && wc.getURL()) || '';
      const snap = await evalFirstOk(wc, PAGE_FP_SCRIPT);
      const fp = String((snap && snap.fp) || '');
      const hrefChanged = Boolean(beforeHref && href && href !== beforeHref);
      const fpChanged = Boolean(beforeFp && fp && fp !== beforeFp);
      if (hrefChanged || fpChanged) return { ok: true, href: href || (snap && snap.href) || '', fp };
    } catch (_) {
      /* navigation mid-eval */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { ok: false };
}

function persistApplyCue(tab, hooks = {}) {
  if (!tab || !tab.jd || !hasApplyCue(tab.jd)) return;
  if (typeof hooks.persistJd === 'function') {
    hooks.persistJd(tab);
    return;
  }
  try {
    const { writeRecord } = require('./process-store');
    if (tab.meta && tab.meta.url) writeRecord(tab.meta.url, { jd: tab.jd });
  } catch (_) {}
}

async function ensureTabJd(wc, tab, hooks = {}) {
  throwIfAborted(tab);
  const out = await ensurePostingJd(tab, {
    evalFn: (script) => evalFirstOk(wc, script),
    onStep: hooks.onStep || (() => {}),
    judge: hooks.judge,
    signal: tab && tab.fillAbort && tab.fillAbort.signal,
    throwIfAborted: () => throwIfAborted(tab),
    getHref: () => (wc && wc.getURL && wc.getURL()) || '',
    waitForChange: (before) => waitForPageChange(wc, before),
    waitAfterApply: () => waitAfterApplyClick(wc, 0),
    onApplyCue: (jd) => {
      tab.jd = jd;
      persistApplyCue(tab, hooks);
    },
  });
  persistApplyCue(tab, hooks);
  return out;
}

async function openApplySurface(wc, tab, hooks = {}) {
  const onStep = hooks.onStep || (() => {});
  const evalFn = hooks.evalFn || ((script) => evalFirstOk(wc, script));
  const loadUrl =
    hooks.loadUrl ||
    (async (href) => {
      if (wc && wc.loadURL) await wc.loadURL(href);
    });
  const before = await evalFn(INVENTORY_SCRIPT);
  const beforeN = ((before && before.fields) || []).length;
  let inv = before;
  if (hasVisibleApplyFields((before && before.fields) || [])) return inv;
  const plan = applyFollowPlan(tab && tab.jd);
  if (plan.action === 'fill') return inv;

  let clicked = null;
  const cta = (plan && plan.cta) || applyCtaOf(tab && tab.jd);
  if (cta && (cta.text || cta.href)) {
    clicked = await evalFn(clickNamedApplyScript(cta));
    const here = (wc && wc.getURL && wc.getURL()) || (inv && inv.href) || '';
    if ((!clicked || !clicked.ok) && cta.href && hrefIsOtherPage(here, cta.href)) {
      await loadUrl(cta.href);
      clicked = { ok: true, text: cta.text || cta.href };
    }
  }
  if (!clicked || !clicked.ok) {
    clicked = await evalFn(CLICK_APPLY_SCRIPT);
  }
  if (clicked && clicked.ok && !clicked.skipped) {
    onStep('Apply?', { detail: `Opening ${clicked.text || 'Apply'}…` });
    inv = hooks.waitAfterApply
      ? await hooks.waitAfterApply(beforeN)
      : await waitAfterApplyClick(wc, beforeN);
  } else if (beforeN === 0 && !hooks.skipEmptyWait) {
    inv = await waitForInventory(wc, 1, 1500);
  }
  return inv;
}

/** Greenhouse-style file/paste widget: reveal the cover-letter textarea, never Resume/CV. */
const CLICK_COVER_PASTE_SCRIPT = `(() => {
  const textOf = (n) => String((n && (n.innerText || n.getAttribute('aria-label'))) || '').replace(/\\s+/g, ' ').trim();
  const PASTE_RE = /^(or\\s+)?enter manually$|^paste(\\s+(in|text|cover letter))?$/i;
  const ESSAY_RE = /\\b(cover letter|motivation letter|letter of interest|personal statement|additional (information|comments|details))\\b/i;
  const RESUME_RE = /\\b(resume|c\\.?v\\.?)\\b/i;
  const SKIP_LINE = /^(attach|dropbox|google drive|or enter manually|enter manually|paste|drop files here|accepted file types.*)$/i;
  const clip = (s) => String(s || '').trim().split('\\n')[0].trim().slice(0, 200);
  const stackScore = (t) => {
    let n = 0;
    if (/\\battach\\b/i.test(t)) n += 1;
    if (/\\bdropbox\\b/i.test(t)) n += 1;
    if (/google drive/i.test(t)) n += 1;
    if (/enter manually/i.test(t)) n += 1;
    return n;
  };
  const stackHost = (btn) => {
    let el = btn.parentElement;
    for (let i = 0; i < 8 && el; i++) {
      if (stackScore(el.innerText || '') >= 3) return el;
      if ((el.getAttribute('data-field') || '') === 'cover_letter') return el;
      if (el.classList && el.classList.contains('attach-or-paste')) return el;
      el = el.parentElement;
    }
    return btn.parentElement;
  };
  const pasteCount = (el) =>
    el
      ? [...el.querySelectorAll('button, a, [role="button"]')].filter(
          (n) => PASTE_RE.test(textOf(n)) || (n.getAttribute('data-source') || '').toLowerCase() === 'paste'
        ).length
      : 0;
  const titledHost = (el) => {
    let n = el;
    for (let i = 0; i < 8 && n; i++) {
      const cls = n.classList;
      if (cls && (cls.contains('file-upload') || cls.contains('field-wrapper') || cls.contains('attach-or-paste') || cls.contains('form-group'))) return n;
      if ((n.getAttribute('data-field') || '') === 'cover_letter') return n;
      if (n.getAttribute('role') === 'group' && pasteCount(n) === 1) return n;
      n = n.parentElement;
    }
    return el;
  };
  const sectionTitle = (host) => {
    if (!host) return '';
    const found = [];
    const add = (s) => {
      const t = clip(String(s || '').replace(/_/g, ' '));
      if (t && !SKIP_LINE.test(t)) found.push(t);
    };
    add(host.getAttribute('data-field'));
    add(host.getAttribute('aria-label'));
    for (const line of String(host.innerText || '').split('\\n').slice(0, 8)) add(line);
    for (const sel of ['legend', 'label', 'h2', 'h3', 'h4', '[class*="label"]']) {
      const n = host.querySelector(sel);
      if (n) add(n.innerText);
    }
    let sib = host.previousElementSibling;
    for (let i = 0; i < 4 && sib; i++) {
      add(sib.innerText);
      sib = sib.previousElementSibling;
    }
    const parent = host.parentElement;
    if (parent) {
      add(parent.getAttribute('aria-label'));
      add(parent.getAttribute('data-field'));
      if (pasteCount(parent) <= 1) {
        for (const line of String(parent.innerText || '').split('\\n').slice(0, 8)) add(line);
      }
    }
    const essay = found.find((t) => ESSAY_RE.test(t) && !RESUME_RE.test(t));
    if (essay) return essay;
    const resume = found.find((t) => RESUME_RE.test(t) && !ESSAY_RE.test(t));
    if (resume) return resume;
    return found[0] || '';
  };
  const isCover = (btn, host) => {
    const named = btn.closest('[data-field], .attach-or-paste');
    const field = (named && named.getAttribute('data-field')) || (host && host.getAttribute('data-field')) || '';
    if (field === 'cover_letter') return true;
    if (field === 'resume') return false;
    const blob = [
      field,
      named && (named.id || ''),
      named && String(named.getAttribute('class') || ''),
      named && (named.getAttribute('data-testid') || ''),
      host && (host.id || ''),
      host && String(host.getAttribute('class') || ''),
    ].join(' ');
    if (/cover[_-]?letter/i.test(blob)) return true;
    if (/\\bresume\\b/i.test(blob) && !/cover/i.test(blob)) return false;
    const fileRoot = named || host;
    const file = fileRoot && fileRoot.querySelector('input[type="file"]');
    const fileTok = file ? String(file.name || '') + String(file.id || '') : '';
    if (/cover/i.test(fileTok)) return true;
    if (/resume|cv/i.test(fileTok) && !/cover/i.test(fileTok)) return false;
    let title = sectionTitle(titledHost(host));
    if (!ESSAY_RE.test(title) && !RESUME_RE.test(title) && host && host.parentElement) {
      title = sectionTitle(host.parentElement) || title;
    }
    if (ESSAY_RE.test(title) && !RESUME_RE.test(title)) return true;
    if (RESUME_RE.test(title) && !ESSAY_RE.test(title)) return false;
    return false;
  };
  const isVisibleBox = (el) => {
    if (!el) return false;
    const st = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== 'none' && st.visibility !== 'hidden' && r.width >= 2 && r.height >= 2;
  };
  const isEdit = (el) => el && (el.tagName === 'TEXTAREA' || el.isContentEditable);
  const visibleTextarea = (host) => {
    if (!host) return false;
    if (isEdit(host) && isVisibleBox(host)) return true;
    return [...host.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')].some(isVisibleBox);
  };
  const sectionRoot = (btn, host) => {
    const named = btn && btn.closest('[data-field="cover_letter"], .file-upload');
    if (named) return named;
    let n = host;
    for (let i = 0; i < 8 && n; i++) {
      if ((n.getAttribute('data-field') || '') === 'cover_letter') return n;
      if (n.classList && n.classList.contains('file-upload')) return n;
      n = n.parentElement;
    }
    return host;
  };
  const alreadyOpen = (btn, host) => {
    if (!btn) return false;
    if (btn.getAttribute('aria-pressed') === 'true' || btn.getAttribute('aria-expanded') === 'true') return true;
    const root = sectionRoot(btn, host);
    if (visibleTextarea(root) || visibleTextarea(host) || visibleTextarea(host && host.parentElement)) return true;
    let sib = host && host.nextElementSibling;
    for (let i = 0; i < 4 && sib; i++) {
      if (visibleTextarea(sib)) return true;
      sib = sib.nextElementSibling;
    }
    const cl = document.getElementById('cover_letter_text');
    return Boolean(cl && isVisibleBox(cl) && ((root && root.contains(cl)) || (host && host.parentElement && host.parentElement.contains(cl))));
  };
  const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
  const clicked = [];
  const already = [];
  const seenHosts = new Set();
  for (const btn of nodes) {
    const src = (btn.getAttribute('data-source') || '').toLowerCase();
    if (src !== 'paste' && !PASTE_RE.test(textOf(btn))) continue;
    const host = stackHost(btn);
    if (seenHosts.has(host) || seenHosts.has(host && host.parentElement)) continue;
    if (!isCover(btn, host)) continue;
    if (alreadyOpen(btn, host)) {
      already.push(textOf(btn) || src || 'paste');
      seenHosts.add(host);
      if (host && host.parentElement) seenHosts.add(host.parentElement);
      continue;
    }
    btn.click();
    seenHosts.add(host);
    if (host && host.parentElement) seenHosts.add(host.parentElement);
    clicked.push(textOf(btn) || src || 'paste');
  }
  if (clicked.length) return { ok: true, clicked: clicked.length, labels: clicked };
  if (already.length) return { ok: true, clicked: 0, already: already.length };
  return { ok: false };
})()`;

function mergeEssaySession(existing, updates) {
  const fields = [...((existing && existing.fields) || [])];
  for (const row of updates) {
    const i = fields.findIndex((f) => f.id === row.id);
    if (i >= 0) fields[i] = { ...fields[i], ...row };
    else fields.push(row);
  }
  return { fields };
}

async function discoverFields(wc, tab, hooks = {}) {
  const profile = loadProfile();
  const onStep = hooks.onStep || (() => {});
  const fill = Boolean(hooks.fill);
  const url = wc.getURL();

  onStep('JD');
  await ensureTabJd(wc, tab, hooks);
  throwIfAborted(tab);
  if (tab.jd && tab.jd.text && !(tab.jd.findings && tab.jd.findings.findings)) {
    tab.jd.findings = scanJobDescription(tab.jd.text);
  }

  onStep('Apply?');
  let inv = await openApplySurface(wc, tab, hooks);
  if (hooks.upload) {
    onStep(fill ? 'Fill' : 'Apply?', { detail: 'Uploading resume…' });
    await hooks.upload();
    await new Promise((r) => setTimeout(r, 400));
    const again = await evalFirstOk(wc, INVENTORY_SCRIPT);
    if (again && ((again.fields || []).length >= ((inv && inv.fields) || []).length)) inv = again;
  }
  const pasted = await evalFirstOk(wc, CLICK_COVER_PASTE_SCRIPT);
  if (pasted && pasted.ok && pasted.clicked) {
    const need = Math.max(1, ((inv && inv.fields) || []).length + 1);
    inv = await waitForInventory(wc, need, 1800);
  } else if (pasted && pasted.already) {
    const again = await evalFirstOk(wc, INVENTORY_SCRIPT);
    if (((again && again.fields) || []).length >= ((inv && inv.fields) || []).length) inv = again;
  }
  const frameHref = (inv && inv.href) || '';
  if (frameHref) {
    tab.atsHref = frameHref;
  }
  if (inv && inv.pageHtml) tab.pageHtml = inv.pageHtml;
  throwIfAborted(tab);
  if (fill) onStep('Fill', hooks.upload ? { detail: '' } : undefined);
  try {
    await evalAllFrames(wc, harvestAttachScript());
  } catch (_) {}
  if (fill) {
    try {
      await evalAllFrames(wc, autoScrollArmScript(false));
    } catch (_) {}
  }
  const fields = dedupInventoryFields((inv && inv.fields) || []);
  if (fill) await hydrateSelectOptions(wc, fields);
  const essayFields = [];
  const debugFields = [];
  const seen = new Set();
  const canaryPhrases = (tab.jd && tab.jd.findings && tab.jd.findings.canaryPhrases) || [];
  const notes = [];
  const ctx = {
    profile,
    debugFields,
    essayFields,
    seen,
    fill,
    skipEssays: Boolean(hooks.skipEssays),
    onStep,
    canaryPhrases,
    tab,
    onNote: (msg) => {
      notes.push(msg);
      onStep(fill ? 'Fill' : 'Apply?', { detail: msg });
    },
  };
  if (fill) {
    try {
      await evalAllFrames(wc, harvestPauseScript(true));
    } catch (_) {}
  }
  try {
    await processFields(wc, fields, ctx);

    if (fill) {
      try {
        await fillEmployment(wc, onStep, tab);
      } catch (err) {
        console.warn('[magnet] employment:', err.message || err);
      }
    }

    const inv2 = await evalFirstOk(wc, INVENTORY_SCRIPT);
    await processFields(wc, await hydrateSelectOptions(wc, dedupInventoryFields((inv2 && inv2.fields) || [])), ctx);
    const fieldCountInner = Math.max(fields.length, ((inv2 && inv2.fields) || []).length);
    tab.debugFields = debugFields;
    tab.reviewNotes = notes;
    return { essayFields, debugFields, fieldCount: fieldCountInner, url, canaryPhrases };
  } finally {
    if (fill) {
      try {
        await evalAllFrames(wc, harvestPauseScript(false));
      } catch (_) {}
    }
  }
}

const LEFTOVER_REVIEW_DETAIL = 'LLM is reviewing leftovers…';
const REVIEW_AND_ESSAYS_DETAIL = 'Drafting essays · reviewing leftovers…';
const MATCHING_DETAIL = 'Matching experience…';

function setEssayBusy(tab, busy) {
  if (tab) tab.essayBusy = Boolean(busy);
}

function reviewEssayDetail(tab, draftingDetail) {
  const reviewing = Boolean(tab && tab.reviewAbort);
  const drafting = Boolean(tab && tab.essayBusy);
  if (reviewing && drafting) return REVIEW_AND_ESSAYS_DETAIL;
  if (reviewing) return LEFTOVER_REVIEW_DETAIL;
  if (drafting) return draftingDetail || MATCHING_DETAIL;
  return draftingDetail || '';
}

async function rematchPageField(wc, field) {
  if (!wc || !field) return field;
  try {
    const still = await evalFirstOk(
      wc,
      `(() => {
        const id = ${JSON.stringify(String(field.id || ''))};
        if (!id) return false;
        const esc = window.CSS && window.CSS.escape ? window.CSS.escape(id) : String(id).replace(/"/g, '');
        return Boolean(document.querySelector('[data-magnet-field="' + esc + '"]'));
      })()`
    );
    if (still) return field;
    const inv = await evalFirstOk(wc, INVENTORY_SCRIPT);
    const rows = (inv && inv.fields) || [];
    if (rows.some((r) => r.id === field.id)) return field;
    const key = normalizeQuestion(field.label || '');
    if (!key) return field;
    const hit =
      rows.find((r) => normalizeQuestion(r.label || '') === key) ||
      rows.find((r) => {
        const k = normalizeQuestion(r.label || '');
        return k && (k.includes(key.slice(0, 28)) || key.includes(k.slice(0, 28)));
      });
    if (!hit) return field;
    return { ...field, id: hit.id, label: field.label || hit.label };
  } catch (_) {
    return field;
  }
}

async function writeCannedOpenLetters(wc, tab, fields, hooks = {}) {
  const onStep = hooks.onStep || (() => {});
  const list = Array.isArray(fields) ? fields.filter(Boolean) : [];
  const updates = [];
  let satisfied = 0;
  if (!list.length) return { essays: 0, drafts: [], updates, reply: '' };
  setEssayBusy(tab, true);
  const stepName = hooks.stepName || 'Essays';
  onStep(stepName, { detail: reviewEssayDetail(tab, 'Typing…'), toast: 'Typing…' });
  try {
    for (const field of list) {
      throwIfAborted(tab);
      const raw = wc ? await evalFirstOk(wc, readFieldScript(field.id)) : '';
      const fromDom = typeof raw === 'string' ? raw : '';
      const current = fromDom || field.value || field.current || '';
      if (!isReplaceableEssay(current)) {
        satisfied += 1;
        continue;
      }
      const live = wc ? await rematchPageField(wc, field) : field;
      const text = coverLetterText(live.maxlength || live.maxLength || field.maxlength);
      if (!text) continue;
      if (wc) {
        await evalFirstOk(wc, busyScript(live.id, true, 'Typing…'));
        const paced = await typeEssay(wc, live, text, tab);
        if (paced && paced.reason === 'not-text') {
          await driveField(wc, live, text, {
            chain: ['input_events', 'native_value'],
            opts: { force: true },
            force: true,
          });
        }
        await evalFirstOk(wc, paintScript(live.id, 'orange'));
        await evalFirstOk(wc, attachMirrorScript(live.id));
        await evalFirstOk(wc, busyScript(live.id, false));
      }
      updates.push({
        id: live.id,
        label: live.label || field.label,
        normalized_key: normalizeQuestion(live.label || field.label),
        llm_draft: text,
        final: text,
        source_card_ids: [],
      });
      satisfied += 1;
    }
    if (tab && tab.meta && tab.meta.id && updates.length) {
      tab.essaySession = mergeEssaySession(tab.essaySession || loadSession(tab.meta.id), updates);
      saveSession(tab.meta.id, tab.essaySession, tab.meta);
    }
  } finally {
    setEssayBusy(tab, false);
  }
  const drafts = updates.map((u) => ({ id: u.id, label: u.label, text: u.final }));
  const reply = updates.length
    ? updates.length === 1
      ? 'Typed the cover letter.'
      : `Typed the cover letter on ${updates.length} fields.`
    : '';
  return { essays: satisfied, drafts, updates, reply };
}

async function draftEssays(wc, tab, essayFields, hooks = {}) {
  const onStep = hooks.onStep || (() => {});
  const instruction = String(hooks.instruction || '').trim();
  const fields = Array.isArray(essayFields) ? essayFields.filter(Boolean) : [];
  const cannedFields = fields.filter((f) => isCannedOpenLetter(f));
  const generateFields = fields.filter((f) => !isCannedOpenLetter(f));
  const cannedIds = new Set(cannedFields.map((f) => f && f.id).filter(Boolean));
  if (!fields.length && !instruction) {
    setEssayBusy(tab, false);
    onStep(tab.reviewAbort ? 'Review' : 'Essays', { detail: reviewEssayDetail(tab) });
    return { ok: true, essays: 0, empty: true, reply: '', drafts: [] };
  }

  let canned = { essays: 0, drafts: [], updates: [], reply: '' };
  if (cannedFields.length) {
    try {
      canned = await writeCannedOpenLetters(wc, tab, cannedFields, {
        onStep,
        stepName: instruction ? 'Chat' : 'Essays',
      });
    } catch (err) {
      if (isFillCancelled(err)) {
        return { ok: true, cancelled: true, essays: 0, empty: false, reply: '', drafts: [] };
      }
      throw err;
    }
  }

  if (!generateFields.length && !instruction) {
    setEssayBusy(tab, false);
    return {
      ok: true,
      essays: canned.essays,
      empty: false,
      reply: canned.reply,
      drafts: canned.drafts,
      asks: [],
      tools: [],
    };
  }

  if (generateFields.length && !process.env.CURSOR_API_KEY) {
    const error = 'missing CURSOR_API_KEY';
    if (tab) tab.essayError = error;
    setEssayBusy(tab, false);
    return {
      ok: false,
      essays: canned.essays,
      empty: false,
      error,
      reply: canned.reply,
      drafts: canned.drafts,
    };
  }

  const payloadFields = [];
  for (const f of generateFields) {
    const raw = wc ? await evalFirstOk(wc, readFieldScript(f.id)) : '';
    const fromDom = typeof raw === 'string' ? raw : '';
    payloadFields.push({
      id: f.id,
      label: f.label,
      maxLength: f.maxlength,
      current: usefulCurrent(fromDom || f.value || ''),
    });
  }

  const harvested = harvestForEssayTurn(instruction);
  const storedAge = harvestedAge(harvested);
  const ageFilled = storedAge && wc ? await applyStoredAge(wc, tab) : [];
  const leftoverPack = leftoversForChat(tab, payloadFields, instruction);

  const company = tab.meta && tab.meta.name;
  const payload = {
    fields: payloadFields,
    leftovers: leftoverPack.leftovers,
    review_fills: leftoverPack.review_fills,
    review_asks: leftoverPack.review_asks,
    profile_age: ageFromProfile(loadProfile()),
    jd: preferPostingJd(tab) || tab.jd,
    company,
    title: tab.meta && tab.meta.title,
    url: (tab.meta && tab.meta.url) || '',
    instruction,
    history: (tab.chat || []).slice(-24).map((m) => ({
      role: m.role,
      text: String(m.text || ''),
      drafts: (m.drafts || [])
        .filter((d) => d && d.text)
        .map((d) => ({ id: d.id, label: d.label || d.id, text: String(d.text) })),
    })),
  };
  const sent = { payload };
  tab.lastLlm = {
    prompt: '',
    fields: payloadFields,
    instruction,
    leftovers: leftoverPack.leftovers,
    review_fills: leftoverPack.review_fills,
    review_asks: leftoverPack.review_asks,
    at: new Date().toISOString(),
  };
  if (hooks.onLlm) hooks.onLlm(tab.lastLlm);

  const leftoverLive = Boolean(tab.reviewAbort);
  const stepName = leftoverLive ? 'Review' : instruction ? 'Chat' : 'Essays';
  onStep(stepName, {
    detail: reviewEssayDetail(tab, 'Thinking…'),
    toast: leftoverLive ? undefined : 'Thinking…',
  });
  await new Promise((r) => setImmediate(r));
  try {
    throwIfAborted(tab);
    const parsed = await invokeEssayTurn(tab, payload, {
      signal: tab.fillAbort && tab.fillAbort.signal,
      onEvent: (ev) => {
        if (ev.op !== 'stage' && ev.type !== 'stage') return;
        onStep(stepName, {
          detail: reviewEssayDetail(tab, ev.detail || 'Thinking…'),
        });
      },
    });
    if (parsed && parsed.prompt) {
      sent.prompt = parsed.prompt;
      tab.lastLlm.prompt = parsed.prompt;
    }
    const split = splitExperienceUpdates((parsed && parsed.experience_updates) || []);
    const profileApplied = applyUpdates([
      ...((parsed && parsed.profile_updates) || []),
      ...split.profile,
    ]);
    const { storyConfirmAsks } = require('./story-confirm');
    const { magnetWouldWrite, parkExtracted } = require('./compile');
    const userText = [instruction, ...(tab.chat || []).filter((m) => m.role === 'you').map((m) => m.text)].join(
      '\n'
    );
    const debriefOpen = Boolean(tab.debrief && (tab.debrief.status === 'open' || tab.debrief.status === 'thinking'));
    let storyAsks = [];
    if (!debriefOpen && split.cards.length) {
      const unquoted = magnetWouldWrite(split.cards, userText);
      const quoted = split.cards.filter((c) => !unquoted.includes(c));
      const parked = unquoted.length ? await parkExtracted(unquoted, { userText, source: 'chat' }) : [];
      storyAsks = [...storyConfirmAsks(quoted), ...storyConfirmAsks(parked)];
    }
    const list = ((parsed && parsed.drafts) || []).map((a) =>
      a && typeof a === 'object' ? { ...a, text: a.text != null ? scrubCardIds(a.text) : a.text } : a
    );
    const paintable = list.filter((a) => a && a.text && !cannedIds.has(a.id));
    const willPaint = paintable.length > 0;
    if (willPaint) {
      setEssayBusy(tab, true);
      onStep(stepName, { detail: reviewEssayDetail(tab, 'Typing…') });
    }
    const fieldPool = [...generateFields];
    const seenField = new Set(fieldPool.map((f) => f && f.id).filter(Boolean));
    for (const extra of tab.debugFields || []) {
      if (extra && extra.id && !seenField.has(extra.id) && !cannedIds.has(extra.id)) {
        fieldPool.push(extra);
        seenField.add(extra.id);
      }
    }
    const fieldForDraft = (id) => fieldPool.find((f) => f && f.id === id);
    if (wc && willPaint) {
      for (const a of paintable) {
        const field = fieldForDraft(a.id);
        if (field && a.text) await evalFirstOk(wc, busyScript(field.id, true, 'Typing…'));
      }
    }
    const selectedIds = Array.isArray(parsed && parsed.selected) ? parsed.selected.filter(Boolean) : [];
    const updates = [];
    for (const a of list) {
      if (cannedIds.has(a.id)) continue;
      const field = fieldForDraft(a.id);
      if (!field || !a.text) continue;
      if (!isEssayableChatField(field) && String(a.text).trim().length >= 120 && field.route !== 'needs_llm') continue;
      const live = wc ? await rematchPageField(wc, field) : field;
      if (wc) {
        const paced = await typeEssay(wc, live, a.text, tab);
        if (paced && paced.reason === 'not-text') {
          await driveField(wc, live, a.text, {
            chain: ['input_events', 'native_value'],
            opts: { force: true },
            force: true,
          });
        }
        await evalFirstOk(wc, paintScript(live.id, field.route === 'static' && !isEssayableChatField(field) ? 'green' : 'orange'));
        await evalFirstOk(wc, attachMirrorScript(live.id));
      }
      updates.push({
        id: live.id,
        label: live.label || field.label,
        normalized_key: normalizeQuestion(live.label || field.label),
        llm_draft: a.text,
        final: a.text,
        source_card_ids: selectedIds,
      });
    }
    if (tab.meta && tab.meta.id) {
      tab.essaySession = mergeEssaySession(tab.essaySession || loadSession(tab.meta.id), updates);
      saveSession(tab.meta.id, tab.essaySession, tab.meta);
    }
    if (wc) {
      for (const field of fields) {
        await evalFirstOk(wc, busyScript(field.id, false));
      }
    }
    const drafts = [...canned.drafts, ...updates.map((u) => ({ id: u.id, label: u.label, text: u.llm_draft }))];
    let reply =
      scrubCardIds((parsed && parsed.reply && String(parsed.reply).trim()) || '') ||
      (updates.length ? `Drafted ${updates.length} field${updates.length === 1 ? '' : 's'}.` : canned.reply || 'Okay.');
    if (canned.reply && updates.length && !/typed the cover letter/i.test(reply)) {
      reply = `${reply}\n\n${canned.reply}`;
    }
    if (storyAsks.length && !/\b(file this work note|keep \/ skip)\b/i.test(reply)) {
      const bit = `Confirm ${storyAsks.length} work note${storyAsks.length === 1 ? '' : 's'} below (Keep, edit employer, or Skip).`;
      reply = reply && reply !== 'Okay.' ? `${reply}\n\n${bit}` : bit;
    }
    if (storedAge) {
      const emptyOpts = leftoverStatics(tab).some((f) => isAgeRangeField(f) && !(f.options || []).length);
      const bits = [];
      if (!/\bage\s+30\b|\bstored that you are\b|\bon the profile\b/i.test(reply)) {
        bits.push(ageFilled.length
          ? `Stored age ${storedAge} and clicked ${ageFilled.map((f) => f.value).join(', ')}.`
          : `Stored age ${storedAge} on the profile.`);
      }
      if (!ageFilled.length && emptyOpts && !/not scraped|no option/i.test(reply)) {
        bits.push('Age-range bubbles were not scraped as options, so Autofill still has nothing to click until inventory sees the pills.');
      }
      if (bits.length) reply = reply && reply !== 'Okay.' ? `${reply}\n\n${bits.join(' ')}` : bits.join(' ');
    }
    const skillBits = profileFactBits(
      [...harvested, ...profileApplied].filter((row) => row.path && row.path.startsWith('skills.'))
    );
    if (skillBits.length && !/\bstored \w+ at \d+ years\b/i.test(reply)) {
      reply = reply && reply !== 'Okay.' ? `${reply}\n\n${skillBits.join(' ')}` : skillBits.join(' ');
    }
    const received = {
      reply: scrubCardIds((parsed && parsed.reply) || ''),
      drafts: list,
      experience_updates: split.cards,
      profile_updates: profileApplied,
      asks: [...((parsed && parsed.asks) || []), ...storyAsks],
      tools: (parsed && parsed.tools) || [],
      raw: (parsed && parsed.raw) || '',
    };
    return {
      ok: true,
      essays: updates.length + canned.essays,
      empty: false,
      reply,
      drafts,
      asks: received.asks,
      tools: received.tools,
      sent,
      received,
    };
  } catch (err) {
    if (wc) {
      for (const field of fields) {
        await evalFirstOk(wc, busyScript(field.id, false));
      }
    }
    if (isFillCancelled(err)) {
      return {
        ok: true,
        cancelled: true,
        essays: canned.essays,
        empty: false,
        reply: canned.reply,
        drafts: canned.drafts,
        sent,
        received: null,
      };
    }
    console.warn('[magnet] essays:', err.message || err);
    tab.essayError = String(err.message || err);
    return {
      ok: false,
      essays: canned.essays,
      empty: false,
      error: tab.essayError,
      reply: canned.reply,
      drafts: canned.drafts,
      sent,
      received: { error: tab.essayError },
    };
  } finally {
    setEssayBusy(tab, false);
  }
}

function pickEssayTargets(found, fieldIds) {
  const all = found.essayFields || [];
  if (!fieldIds || !fieldIds.length) return all;
  const want = new Set(fieldIds);
  const hit = all.filter((f) => want.has(f.id));
  if (hit.length) return hit;
  return (found.debugFields || []).filter((f) => want.has(f.id) && isEssayableChatField(f));
}

/**
 * Cmd-D / Autofill. Never uploads. Never Next/Submit. Apply once allowed.
 */
function choiceClusterKey(f) {
  if (!f) return '';
  const text = questionTextKey(f);
  if (text) return text;
  const choice =
    f.type === 'checkbox' ||
    f.type === 'radio' ||
    (f.shape && f.shape.family === 'choice_group');
  if (!choice) return '';
  const cid = String(f.clusterId || '');
  if (/^[nb]:/.test(cid)) return 'cid:' + cid;
  const heading = normalizeQuestion(f.heading || '');
  const label = normalizeQuestion(f.label || '');
  return heading.length >= 16 ? heading : heading || label;
}

function choiceClusterSettled(f) {
  if (!f) return false;
  const g = reviewGate(f, { afterRetry: true });
  return g.reason === 'landed' || g.reason === 'known-not-empty';
}

function collapseChoiceResiduals(residuals, allFields) {
  const settled = new Set();
  for (const f of allFields || []) {
    const key = choiceClusterKey(f);
    if (key && choiceClusterSettled(f)) settled.add(key);
  }
  const out = [];
  const seen = new Set();
  for (const f of residuals || []) {
    const key = choiceClusterKey(f);
    if (key) {
      if (settled.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (f) out.push(f);
  }
  return out;
}

function factAsks(fields) {
  return (fields || [])
    .map((f) => {
      const g = reviewGate(f, { afterRetry: true });
      if (!g.ask || (g.reason !== 'no-fact' && g.reason !== 'unlabeled')) return null;
      const klass = g.class || '';
      return {
        id: f.id,
        question: f.label || g.question || '',
        why: reviewAskWhy(g.reason, klass),
        reason: g.reason,
        class: klass,
        pageValue: String(f.current || f.value || f.prefill || '').trim(),
        answered: false,
      };
    })
    .filter(Boolean);
}

function fillsFromResiduals(residuals, existing) {
  const have = new Set((existing || []).map((f) => f.id));
  return filterAskable(residuals, { afterRetry: true })
    .filter((f) => f && f.id && !have.has(f.id) && String(f.intended || '').trim())
    .slice(0, 16)
    .map((f) => {
      const g = reviewGate(f, { afterRetry: true });
      return {
        id: f.id,
        value: String(f.intended || ''),
        reason:
          g.reason === 'wrong-intended'
            ? 'Magnet put a different value'
            : g.reason === 'couldnt-land' || f.residual === 'red'
              ? 'Could not fill'
              : f.residual || g.reason || '',
        gate: g.reason || '',
        steps: fillStepsFor(f),
        label: f.label || f.id,
        type: f.type,
        options: f.options || [],
        shape: f.shape,
        accepted: false,
      };
    });
}

async function retryKnownResiduals(wc, tab, residuals, found) {
  const profile = loadProfile();
  let changed = false;
  for (const field of residuals || []) {
    const gate = reviewGate(field);
    if (!gate.retry || gate.value == null || gate.value === '') continue;
    const recipe = findRecipe({ label: field.label, field });
    const fp = fpFor(field);
    const chain = fillChain(field, fp, {
      salary: isSalaryField(field) || isSalaryHistoryField(field) || field.type === 'number',
      value: gate.value,
    });
    const result = await driveField(wc, field, gate.value, {
      chain,
      opts: { ...fillOpts(field, profile, recipe), force: true },
      recipe,
      force: true,
    });
    field.intended = gate.value;
    if (result && result.ok) {
      field.current = result.value != null ? result.value : gate.value;
      field.magnetState = 'green';
      field.fill = fillTrace(result, chain);
      try {
        await evalFirstOk(wc, paintScript(field.id, 'green'));
      } catch (_) {}
    } else if (result && result.value != null) {
      field.current = result.value;
    }
    changed = true;
  }
  if (!changed) return residuals || [];
  const findings = tab.jd && tab.jd.findings;
  const canaryPhrases = (found && found.canaryPhrases) || (findings && findings.canaryPhrases) || [];
  const next = auditFields(tab.debugFields, { canaryPhrases, findings });
  tab.audit = next;
  tab.debugFields = next.fields;
  return next.residuals || [];
}

function seedResidualReview(tab, residuals) {
  const { leftoverReviewRows } = require('./review-copy');
  const collapsed = collapseChoiceResiduals(residuals, tab.debugFields);
  const existing = (tab.review && tab.review.fills) || [];
  const fallback = fillsFromResiduals(collapsed, existing);
  const asks = factAsks(collapsed);
  const extra = leftoverReviewRows(tab.debugFields || collapsed, fallback.concat(asks, existing)).map((row) => {
    const field = (tab.debugFields || collapsed).find((f) => f && f.id === row.id) || row;
    return { ...row, steps: fillStepsFor(field), accepted: false };
  });
  if (!fallback.length && !extra.length && !asks.length) return 0;
  tab.review = mergeReview(tab.review, {
    fills: fallback.concat(extra),
    asks,
    runs: [],
    at: new Date().toISOString(),
  });
  return fallback.length + extra.length + asks.length;
}

function applyReviewLearning(parsed, fields) {
  const catalog = require('./question-catalog');
  const byId = new Map((fields || []).map((f) => [f.id, f]));
  const rows = [
    ...((parsed && parsed.fills) || []).map((row) => ({ ...row, field: byId.get(row.id) })),
    ...((parsed && parsed.profile_updates) || []).map((row) => ({
      class_id: row.class_id || row.class,
      value: row.value,
      field: byId.get(row.id) || { label: row.label || '' },
    })),
  ];
  for (const row of rows) {
    const hinted = String((row && row.class_id) || (row && row.class) || '').trim();
    if (!row.field) continue;
    const chosen = catalog.chosenClass(hinted);
    if (chosen === 'skip') {
      if (row.field.label) {
        try {
          learnRecipe({ label: row.field.label, route: 'skip' });
        } catch (_) {}
      }
      continue;
    }
    if (!chosen) continue;
    if (catalog.aliasClassId(chosen) && row.field.label) {
      try {
        catalog.learnAlias(chosen, row.field.label);
      } catch (_) {}
    }
    const raw = String(row.value == null ? '' : row.value).trim();
    if (raw && catalog.classFitsValue(chosen, raw, row.field)) {
      confirmClass(chosen, raw, { source: 'review', label: row.field.label || '' });
    }
  }
}

function persistReviewRecipes(parsed, fields) {
  const byId = new Map((fields || []).map((f) => [f.id, f]));
  const fillsById = new Map(((parsed && parsed.fills) || []).map((f) => [f.id, f]));
  for (const rec of (parsed && parsed.recipes) || []) {
    const field = byId.get(rec.field_id) || byId.get(rec.id);
    const label = rec.label || (field && field.label);
    if (!label) continue;
    const fill = fillsById.get(rec.field_id) || fillsById.get(rec.id) || fillsById.get(field && field.id);
    try {
      learnRecipe({
        label,
        label_includes: rec.label_includes && rec.label_includes.length ? rec.label_includes : undefined,
        steps: rec.steps && rec.steps.length ? rec.steps : undefined,
        shape: field && field.shape,
        field,
        value: rec.value || (fill && fill.value) || '',
      });
    } catch (_) {}
  }
}

function stampInferredFills(fills, fields) {
  const byId = new Map((fields || []).map((f) => [f.id, f]));
  return (fills || []).map((row) => {
    if (!row || !row.id) return row;
    if (row.gate === 'inferred') return row;
    const field = byId.get(row.id) || {};
    const infer =
      field.residual === 'needs-infer' ||
      field.reason === 'needs-infer' ||
      row.gate === 'needs-infer';
    if (!infer) return row;
    return {
      ...row,
      gate: 'inferred',
      profileValue: row.profileValue || field.profileValue || '',
    };
  });
}

async function applyInferredReviewFills(wc, tab, fills) {
  if (!wc) return fills || [];
  const profile = loadProfile();
  for (const row of fills || []) {
    if (!row || row.gate !== 'inferred') continue;
    const typed = String(row.value == null ? '' : row.value).trim();
    if (!typed) continue;
    const field = ((tab && tab.debugFields) || []).find((f) => f.id === row.id);
    if (!field) continue;
    const recipe = findRecipe({ label: field.label, field });
    const fp = fpFor(field);
    const chain = fillChain(field, fp, {
      salary: isSalaryField(field) || isSalaryHistoryField(field),
      value: typed,
    });
    const result = await driveField(wc, field, typed, {
      chain,
      opts: { ...fillOpts(field, profile, recipe), force: true },
      recipe,
      force: true,
      steps: row.steps,
    });
    if (result && result.ok) {
      field.current = (result.value != null ? result.value : typed) || typed;
      field.intended = typed;
      field.magnetState = 'green';
      field.fill = fillTrace(result, chain);
      try {
        await evalFirstOk(wc, paintScript(field.id, 'green'));
      } catch (_) {}
    }
  }
  return fills || [];
}

async function runReviewPass(wc, tab, { residuals, allowRuns, instruction, onStep, focusId, quiet }) {
  if (wc) {
    await hydrateSelectOptions(wc, residuals || [], { open: true });
  }
  const findings = tab.jd && tab.jd.findings;
  const instructed = Boolean(String(instruction || '').trim());
  const collapsed = collapseChoiceResiduals(residuals, tab.debugFields);
  const slimResiduals = instructed ? collapsed : filterAskable(collapsed, { afterRetry: true });
  const seededAsks = instructed ? [] : factAsks(slimResiduals);
    const llmResiduals = instructed
    ? slimResiduals
    : slimResiduals.filter((f) => {
        const g = reviewGate(f, { afterRetry: true });
        return (
          g.reason === 'unlabeled' ||
          g.reason === 'no-fact' ||
          g.reason === 'needs-infer' ||
          g.reason === 'options-changed' ||
          g.reason === 'fuzzy' ||
          g.reason === 'contradicted' ||
          g.reason === 'required_empty' ||
          g.reason === 'wrong-intended' ||
          g.reason === 'couldnt-land'
        );
      });
  if (!llmResiduals.length && !instructed) {
    if (seededAsks.length) {
      const review = { kind: 'review', fills: [], asks: seededAsks, runs: [], recipes: [], at: new Date().toISOString() };
      tab.review = mergeReview(tab.review, review);
      return { fills: [], asks: seededAsks, runs: [], recipes: [], reply: '', kind: 'review' };
    }
    onStep &&
      onStep(tab.essayBusy ? tab.autofillStep || 'Essays' : 'Review', {
        detail: reviewEssayDetail(tab),
      });
    return { fills: [], asks: [], runs: [], recipes: [], reply: '', kind: 'review' };
  }
  const ac = quiet ? null : attachReviewAbort(tab);
  const signal = quiet ? tab.fieldChatAbort && tab.fieldChatAbort.signal : ac && ac.signal;
  const parallel = Boolean(tab && tab.runKind === 'all');
  const leftoverDetail = reviewEssayDetail(tab);
  if (!quiet) {
    onStep &&
      onStep(tab.essayBusy ? tab.autofillStep || 'Essays' : 'Review', {
        detail: leftoverDetail,
        toast: parallel && tab.essayBusy ? undefined : leftoverDetail,
      });
  }
  try {
    const parsed = await spawnReview(
      {
        residuals: llmResiduals,
        fields: (tab && tab.debugFields) || [],
        findings,
        instruction: instruction || '',
        allowRuns: Boolean(allowRuns),
        focus_id: focusId || '',
        chat_digest: chatDigest(tab),
        prior: reviewDigest(tab),
        pageHtml: tab && tab.pageHtml,
      },
      { signal }
    );
    const promoted = promoteAsksToFills(
      (parsed.asks || []).map((a) => ({ ...a, answered: false })),
      decorateFills(parsed.fills, tab.debugFields),
      tab.debugFields
    );
    const inferred = stampInferredFills(promoted.fills, tab.debugFields);
    applyReviewLearning({ ...parsed, fills: inferred }, tab.debugFields);
    persistReviewRecipes({ ...parsed, fills: inferred }, tab.debugFields);
    const fills = dropLandedFills(
      inferred.concat(fillsFromResiduals(slimResiduals, inferred)).map((row) => {
        const field = (tab.debugFields || []).find((f) => f.id === row.id) || row;
        return { ...field, ...row, intended: row.value || field.intended, residual: field.residual || 'review' };
      }).filter((row) => row.gate === 'inferred' || shouldAskReview(row, { afterRetry: true })),
      tab.debugFields
    ).map((f) => ({
      id: f.id,
      value: f.value || f.intended || '',
      fallbacks: f.fallbacks || [],
      reason: f.reason || '',
      gate: f.gate || '',
      steps: f.steps || fillStepsFor(f),
      label: f.label || f.id,
      accepted: Boolean(f.accepted),
      profileValue: f.profileValue || '',
      intended: f.intended || '',
      options: f.options,
      type: f.type,
      tag: f.tag,
      select: f.select,
      reactSelect: f.reactSelect,
      shape: f.shape,
    }));
    if (wc) await applyInferredReviewFills(wc, tab, fills);
    const asks = [...seededAsks, ...(promoted.asks || [])];
    const runs = allowRuns ? decorateRuns(parsed.runs, tab.debugFields) : [];
    const recipes = decorateRecipes(parsed.recipes, tab.debugFields).map((r) => {
      const fill = fills.find((f) => f.id === r.field_id || f.id === r.id);
      if (fill && fill.gate === 'inferred') return { ...r, accepted: true };
      return r;
    });
    const profileApplied = applyUpdates([
      ...(parsed.profile_updates || []),
      ...inferFromText(instruction || ''),
    ]);
    if (wc && profileApplied.some((row) => row.path === 'identity.age')) {
      await applyStoredAge(wc, tab);
    }
    const review = {
      kind: 'review',
      reply: parsed.reply || '',
      fills,
      asks,
      runs,
      recipes,
      at: new Date().toISOString(),
    };
    tab.review = mergeReview(tab.review, review);
    tab.lastReview = {
      prompt: parsed.prompt,
      payload: parsed.payload,
      raw: parsed.raw,
      at: review.at,
      allowRuns: Boolean(allowRuns),
    };
    return { ...parsed, fills, asks, runs, kind: 'review' };
  } finally {
    if (ac && tab.reviewAbort === ac) tab.reviewAbort = null;
  }
}

async function reviewFieldChat(wc, tab, { fieldId, text }) {
  const field = findReviewField(tab, fieldId);
  if (!field) return { ok: false, error: 'no-field' };
  const instruction = String(text || '').trim();
  if (!instruction) return { ok: false, error: 'empty' };
  if (tab.fieldChatAbort) {
    try {
      tab.fieldChatAbort.abort();
    } catch (_) {}
  }
  tab.fieldChatAbort = new AbortController();
  tab.reviewFieldChats = tab.reviewFieldChats || {};
  tab.reviewFieldChats[fieldId] = { you: instruction, reply: '', busy: true, error: '' };
  try {
    const shot = await runReviewPass(wc, tab, {
      residuals: [{ ...field, residual: field.residual || 'review' }],
      allowRuns: false,
      focusId: field.id,
      quiet: true,
      instruction: `Field chat on "${field.label || field.id}" (${field.id}). Applicant: ${instruction}`,
    });
    const reply = (shot && shot.reply) || '';
    tab.reviewFieldChats[fieldId] = { you: instruction, reply, busy: false, error: '' };
    return { ok: true, review: shot, reply };
  } catch (err) {
    if (isReviewCancelled(err) || isFillCancelled(err)) {
      tab.reviewFieldChats[fieldId] = { you: instruction, reply: '', busy: false, error: '' };
      return { ok: false, cancelled: true };
    }
    const error = String((err && err.message) || err);
    tab.reviewFieldChats[fieldId] = { you: instruction, reply: '', busy: false, error };
    return { ok: false, error };
  } finally {
    tab.fieldChatAbort = null;
  }
}

function mergeReview(prev, next) {
  const fills = [...((next && next.fills) || [])];
  const asks = [...((next && next.asks) || [])];
  const runs = [...((next && next.runs) || [])];
  const recipes = [...((next && next.recipes) || [])];
  const uncertainties = [...((next && next.uncertainties) || [])];
  if (prev) {
    for (const f of prev.fills || []) {
      if (!fills.some((x) => x.id === f.id) && !f.accepted) fills.push(f);
    }
    for (const a of prev.asks || []) {
      if (!asks.some((x) => x.question === a.question) && !a.answered) asks.push(a);
    }
    for (const r of prev.runs || []) {
      if (!runs.some((x) => x.id === r.id && x.source === r.source) && !r.accepted) runs.push(r);
    }
    for (const r of prev.recipes || []) {
      if (!recipes.some((x) => x.id === r.id) && !r.accepted && !r.dismissed) recipes.push(r);
    }
    for (const u of prev.uncertainties || []) {
      if (!uncertainties.some((x) => x.id === u.id)) uncertainties.push(u);
    }
  }
  return {
    kind: 'review',
    reply: (next && next.reply) || (prev && prev.reply) || '',
    fills,
    asks,
    runs,
    recipes,
    uncertainties,
    at: (next && next.at) || new Date().toISOString(),
  };
}

async function focusNextAccept(wc, tab, exceptId) {
  const next =
    ((tab.review && tab.review.fills) || []).find((f) => f && !f.accepted && !f.dismissed && f.id !== exceptId) ||
    ((tab.review && tab.review.asks) || [])
      .filter((a) => a && a.id && !a.answered && a.id !== exceptId)
      .map((a) => ({ id: a.id }))[0];
  if (!next) {
    tab.reviewFocus = '';
    tab.reviewFlashId = '';
    return;
  }
  tab.reviewFocus = next.id;
  tab.reviewFlashId = next.id;
  tab.reviewFlashAt = Date.now();
  try {
    await evalFirstOk(wc, flashFieldScript(next.id));
  } catch (_) {}
}

function genericReplaySteps(field, value, result) {
  const strategy = (result && result.strategy) || '';
  const family = widgetFamily(field);
  const t = String((field && field.type) || '').toLowerCase();
  if (t === 'radio' || t === 'checkbox' || family === 'choice_group') {
    return [{ op: 'clickOption' }];
  }
  const dance =
    field &&
    (field.reactSelect ||
      strategy === 'react_select' ||
      strategy === 'combobox' ||
      family === 'react_select' ||
      family === 'combobox')
      ? [
          { op: 'click', selector: '.select__control' },
          { op: 'type' },
          { op: 'clickOption' },
        ]
      : [];
  const folded = foldPokeIntoSteps(
    dance,
    strategy === 'date_mask' && !looksLikeDateFill(field, { value }) ? '' : strategy
  );
  return folded.length ? folded : undefined;
}

function completeReplaySteps(field, steps, strategy) {
  const generic = genericReplaySteps(field, field && field.intended, { strategy: strategy || '' }) || [];
  const list = Array.isArray(steps) ? steps.filter((s) => s && typeof s === 'object') : [];
  if (!generic.length) return list;
  if (!list.length) return generic;
  const { dance, poke } = splitRecipeSteps(list);
  const ops = new Set(dance.map((s) => s && s.op));
  const wantsTypeahead = generic.some((s) => s.op === 'type' || s.op === 'clickOption');
  if (!wantsTypeahead || ops.has('type') || ops.has('clickOption')) return list;
  const click = dance.find((s) => s && s.op === 'click');
  const merged = generic
    .filter((s) => s.op !== 'poke')
    .map((s) => (s.op === 'click' && click && click.selector ? { ...s, selector: click.selector } : { ...s }));
  return foldPokeIntoSteps(merged, poke || strategy);
}

function learnNoticePoke(tab, field, value, result, extra = {}) {
  if (!field || !result || !result.ok || result.skipped) return null;
  if (result.strategy === 'steps' || result.strategy === 'run') return null;
  if (!isNoticeStrategy(result.strategy)) return null;
  if (result.strategy === 'date_mask' && !looksLikeDateFill(field, { value })) return null;
  const prior =
    (Array.isArray(extra.steps) && extra.steps.length && extra.steps) ||
    (extra.recipe && extra.recipe.steps) ||
    genericReplaySteps(field, value, result) ||
    [];
  return learnFromAct(tab, field, value, {
    steps: completeReplaySteps(field, foldPokeIntoSteps(prior, result.strategy), result.strategy),
    selector: extra.selector,
    shape: extra.shape || field.shape,
  });
}

function fillStepsFor(field) {
  if (!field) return [];
  const recipe = findRecipe({ label: field.label, field });
  const strategy = (field.fill && field.fill.strategy) || '';
  if (recipe && Array.isArray(recipe.steps) && recipe.steps.length) {
    return completeReplaySteps(field, recipe.steps, strategy);
  }
  return genericReplaySteps(field, field.intended, { strategy }) || [];
}

function findReviewField(tab, fieldId, extra = {}) {
  const fields = (tab && tab.debugFields) || [];
  const byId = fields.find((f) => f.id === fieldId);
  if (byId) return byId;
  const lab = normalizeQuestion((extra && extra.label) || '');
  if (!lab) return null;
  const exact = fields.find((f) => normalizeQuestion(f.label || '') === lab);
  if (exact) return exact;
  if (lab.length < 12) return null;
  return (
    fields.find((f) => {
      const fl = normalizeQuestion(f.label || '');
      if (!fl || fl === lab) return false;
      if (fl.includes(lab) && fl.length - lab.length <= 4) return true;
      if (lab.includes(fl) && lab.length - fl.length <= 4) return true;
      return false;
    }) || null
  );
}

function fieldForReviewRow(tab, row) {
  if (!row) return null;
  return (
    findReviewField(tab, row.field_id || row.id, { label: row.label }) ||
    ((tab.debugFields || []).find((f) => isHearAboutField(f) && /linkedin/i.test(String(row.value || ''))) || null)
  );
}

function sameHearAboutRow(field, row, typed) {
  if (!field || !row) return false;
  if (normalizeQuestion(row.label || '') === normalizeQuestion(field.label || '')) return true;
  return (
    /linkedin/i.test(String(typed || '')) &&
    isHearAboutField(field) &&
    (isHearAboutField({ label: row.label, options: field.options }) || isInstructionLabel(row.label))
  );
}

function learnFromAct(tab, field, value, extra = {}) {
  if (field) {
    try {
      rememberFootprint(field.label, optionTexts(field), String(value || ''), 'taught');
    } catch (_) {}
  }
  if (!field || field.route === 'employment' || field.route === 'needs_llm') return null;
  const steps = Array.isArray(extra.steps) && extra.steps.length ? extra.steps : null;
  const selector =
    extra.selector && !isEphemeralSelector(extra.selector) ? String(extra.selector).trim() : '';
  const shape = field.shape || extra.shape;
  if (!steps && !selector) return null;
  return learnRecipe({
    label: field.label,
    selector: selector || undefined,
    steps,
    shape,
  });
}

function reviewFillRow(tab, fieldId) {
  return ((tab && tab.review && tab.review.fills) || []).find((f) => f && (f.id === fieldId));
}

function intendedForRecord(tab, field) {
  const row = field && reviewFillRow(tab, field.id);
  return String((row && row.value) || (field && (field.intended || field.current)) || '').trim();
}

async function settleFillField(wc, fieldId) {
  try {
    await evalFirstOk(wc, settleFieldScript(fieldId));
  } catch (_) {}
}

async function runFieldSteps(wc, field, steps, value) {
  return driveField(wc, field, value, {
    steps,
    recipe: { steps, match: 'exact' },
    recipeOnly: true,
  });
}

async function proveFillSteps(wc, field, steps, intended) {
  const want = String(intended || '').trim();
  const list = Array.isArray(steps) ? steps : [];
  if (!field || !list.length || !want) {
    return { ok: false, proved: false, stage: 'missing', decoy: null, intended: want, reads: [] };
  }
  const decoy = pickDecoy(field, want);
  const reads = [];
  if (decoy) {
    const a = await runFieldSteps(wc, field, list, decoy);
    const got = a && a.value != null ? a.value : '';
    const ok = valuesEqual(decoy, got, field);
    reads.push({ stage: 'decoy', want: decoy, got, ok });
    await settleFillField(wc, field.id);
    if (!ok) {
      const restore = await runFieldSteps(wc, field, list, want);
      const gotR = restore && restore.value != null ? restore.value : '';
      reads.push({ stage: 'restore', want, got: gotR, ok: valuesEqual(want, gotR, field) });
      return { ok: false, proved: false, stage: 'decoy', decoy, intended: want, reads };
    }
  }
  const b = await runFieldSteps(wc, field, list, want);
  const gotB = b && b.value != null ? b.value : '';
  const okB = valuesEqual(want, gotB, field);
  reads.push({ stage: 'intended', want, got: gotB, ok: okB });
  if (!okB && decoy) {
    const retry = await runFieldSteps(wc, field, list, want);
    const gotRetry = retry && retry.value != null ? retry.value : '';
    const okRetry = valuesEqual(want, gotRetry, field);
    reads.push({ stage: 'intended-retry', want, got: gotRetry, ok: okRetry });
    return { ok: okRetry, proved: false, stage: 'intended', decoy, intended: want, reads };
  }
  return { ok: okB, proved: Boolean(decoy) && okB, decoy, intended: want, reads };
}

function markFillAccepted(tab, field, typed) {
  const fieldId = field && field.id;
  if (tab.review && tab.review.fills) {
    for (const row of tab.review.fills) {
      if (row.id === fieldId || (field && sameHearAboutRow(field, row, typed))) {
        row.accepted = true;
        row.value = typed;
      }
    }
  }
  if (tab.review && tab.review.recipes) {
    for (const rec of tab.review.recipes) {
      if (rec.field_id === fieldId || rec.id === fieldId || (field && sameHearAboutRow(field, rec, typed))) {
        rec.accepted = true;
      }
    }
  }
  if (tab.review && tab.review.asks) {
    for (const row of tab.review.asks) {
      if (row.id === fieldId) {
        row.answered = true;
        row.answer = typed;
      }
    }
  }
}

async function commitLearnedFill(wc, tab, field, typed, steps, extra = {}) {
  const ask =
    tab.review &&
    tab.review.asks &&
    tab.review.asks.find((a) => a && field && (a.id === field.id));
  rememberAnswer(field, typed, {
    source: extra.source || 'accept',
    classId: extra.classId || (ask && ask.class) || '',
  });
  if (steps && steps.length) {
    learnFromAct(tab, field, typed, {
      steps: completeReplaySteps(field, foldPokeIntoSteps(steps, extra.strategy), extra.strategy),
    });
  } else {
    learnNoticePoke(tab, field, typed, { ok: true, strategy: extra.strategy }, extra);
  }
  recordWin(fpFor(field), extra.strategy || 'steps');
  field.current = typed;
  field.intended = typed;
  field.magnetState = 'green';
  markFillAccepted(tab, field, typed);
  tab.reviewCounts = { ...(tab.reviewCounts || {}), accepted: ((tab.reviewCounts || {}).accepted || 0) + 1 };
  try {
    await evalFirstOk(wc, paintScript(field.id, 'green'));
  } catch (_) {}
  await focusNextAccept(wc, tab, field.id);
  tab.fillRecord = null;
  return { ok: true, learned: true, proved: Boolean(extra.proved) };
}

async function learnReviewSteps(wc, tab, { fieldId, steps, value }) {
  const field = findReviewField(tab, fieldId);
  if (!field) return { ok: false, error: 'no-field' };
  const typed = String(value != null ? value : intendedForRecord(tab, field) || '').trim();
  const list = Array.isArray(steps) && steps.length ? steps : fillStepsFor(field);
  if (!list.length) return { ok: false, error: 'no-steps' };
  tab.fillRecord = {
    fieldId: field.id,
    status: 'verifying',
    steps: list,
    intended: typed,
    decoy: pickDecoy(field, typed) || '',
    error: '',
    proved: false,
    reads: [],
  };
  const proof = await proveFillSteps(wc, field, list, typed);
  tab.fillRecord = {
    ...tab.fillRecord,
    status: proof.ok ? 'verified' : 'failed',
    decoy: proof.decoy || '',
    proved: Boolean(proof.proved),
    reads: proof.reads || [],
    error: proof.ok
      ? proof.proved
        ? ''
        : 'Landed. No other option to double-check.'
      : proof.stage === 'decoy'
        ? 'Decoy did not land. These steps did not change the field.'
        : 'Could not write the intended value with these steps.',
  };
  if (!proof.ok) {
    try {
      await evalFirstOk(wc, paintScript(field.id, 'red'));
    } catch (_) {}
    return { ok: false, error: tab.fillRecord.error, proof, fillRecord: tab.fillRecord };
  }
  return commitLearnedFill(wc, tab, field, typed, list, {
    strategy: 'steps',
    source: 'learn-steps',
    proved: proof.proved,
  });
}

async function startFillRecord(wc, tab, { fieldId }) {
  const field = findReviewField(tab, fieldId);
  if (!field) return { ok: false, error: 'no-field' };
  if (tab.fillRecord && tab.fillRecord.status === 'recording' && wc) {
    try {
      await evalFirstOk(wc, recordStopScript());
    } catch (_) {}
  }
  const started = await evalFirstOk(wc, recordStartScript(field.id));
  if (!started || !started.ok) return { ok: false, error: (started && started.reason) || 'missing' };
  tab.fillRecord = {
    fieldId: field.id,
    status: 'recording',
    steps: [],
    intended: intendedForRecord(tab, field),
    decoy: '',
    error: '',
    proved: false,
    reads: [],
  };
  tab.reviewFocus = field.id;
  try {
    await evalFirstOk(wc, flashFieldScript(field.id));
  } catch (_) {}
  return { ok: true, fillRecord: tab.fillRecord };
}

async function stopFillRecord(wc, tab, { fieldId } = {}) {
  const rec = tab && tab.fillRecord;
  const id = (fieldId || (rec && rec.fieldId) || '').trim();
  const field = findReviewField(tab, id);
  if (!field) return { ok: false, error: 'no-field' };
  const stopped = await evalFirstOk(wc, recordStopScript());
  if (!stopped || !stopped.ok) {
    tab.fillRecord = {
      fieldId: field.id,
      status: 'failed',
      steps: [],
      intended: intendedForRecord(tab, field),
      decoy: '',
      error: 'No recording on that field.',
      proved: false,
      reads: [],
    };
    return { ok: false, error: 'not-recording', fillRecord: tab.fillRecord };
  }
  const steps = compileRecordedEvents(stopped.events);
  const typed = intendedForRecord(tab, field) || String(stopped.value || '').trim();
  tab.fillRecord = {
    fieldId: field.id,
    status: 'verifying',
    steps,
    intended: typed,
    decoy: pickDecoy(field, typed) || '',
    error: steps.length ? '' : 'No fill actions captured.',
    proved: false,
    reads: [],
  };
  if (!steps.length) {
    tab.fillRecord.status = 'failed';
    return { ok: false, error: tab.fillRecord.error, fillRecord: tab.fillRecord };
  }
  const proof = await proveFillSteps(wc, field, steps, typed);
  tab.fillRecord = {
    ...tab.fillRecord,
    status: proof.ok ? 'verified' : 'failed',
    decoy: proof.decoy || '',
    proved: Boolean(proof.proved),
    reads: proof.reads || [],
    error: proof.ok
      ? proof.proved
        ? ''
        : 'Landed. No other option to double-check.'
      : proof.stage === 'decoy'
        ? 'Decoy did not land. Record the open → type → pick again.'
        : 'Could not write the intended value with these steps.',
  };
  if (proof.ok) {
    try {
      await evalFirstOk(wc, paintScript(field.id, 'green'));
    } catch (_) {}
  }
  return { ok: true, fillRecord: tab.fillRecord, proof };
}

async function confirmFillRecord(wc, tab, { fieldId } = {}) {
  const rec = tab && tab.fillRecord;
  const id = fieldId || (rec && rec.fieldId);
  if (!rec || rec.fieldId !== id) return { ok: false, error: 'no-record' };
  if (rec.status !== 'verified') return { ok: false, error: rec.error || 'not-verified' };
  const field = findReviewField(tab, id);
  if (!field) return { ok: false, error: 'no-field' };
  const typed = rec.intended || intendedForRecord(tab, field);
  return commitLearnedFill(wc, tab, field, typed, rec.steps, {
    strategy: 'steps',
    source: 'record',
    proved: rec.proved,
  });
}

function markReviewAccepted(tab, field, fieldId, typed) {
  if (tab.review && tab.review.fills) {
    for (const row of tab.review.fills) {
      if (row.id === fieldId || row.id === field.id || sameHearAboutRow(field, row, typed)) {
        row.accepted = true;
        row.value = typed;
      }
    }
  }
  if (tab.review && tab.review.recipes) {
    for (const rec of tab.review.recipes) {
      if (rec.field_id === field.id || rec.id === field.id || sameHearAboutRow(field, rec, typed)) {
        rec.accepted = true;
      }
    }
  }
  if (tab.review && tab.review.asks) {
    for (const row of tab.review.asks) {
      if (row.id === fieldId || row.id === field.id) {
        row.answered = true;
        row.answer = typed;
      }
    }
  }
}

async function acceptReviewFill(wc, tab, { fieldId, value, steps, label, skip, classId }) {
  const field = findReviewField(tab, fieldId, { label });
  if (!field) return { ok: false, error: 'no-field' };
  const typed = value != null ? String(value) : '';
  const ask =
    tab.review &&
    tab.review.asks &&
    tab.review.asks.find((a) => a && (a.id === fieldId || a.id === field.id));
  const chosen = classId || (ask && ask.class) || '';
  if (skip || !String(typed).trim()) {
    rememberAnswer(field, '', { source: 'accept', classId: 'skip', skip: true });
    await evalFirstOk(wc, paintScript(field.id, 'skip'));
    field.intended = '';
    field.current = field.current || '';
    field.magnetState = 'skip';
    field.route = 'skip';
    markReviewAccepted(tab, field, fieldId, '');
    tab.reviewCounts = { ...(tab.reviewCounts || {}), accepted: ((tab.reviewCounts || {}).accepted || 0) + 1 };
    await focusNextAccept(wc, tab, fieldId);
    return { ok: true, skipped: true, learned: true };
  }
  const profile = loadProfile();
  const recipe = findRecipe({ label: field.label, field });
  const fp = fpFor(field);
  const result = await driveField(wc, field, typed, {
    chain: fillChain(field, fp, {
      salary: isSalaryField(field) || isSalaryHistoryField(field),
      value: typed,
    }),
    opts: { ...fillOpts(field, profile, recipe), force: true },
    recipe,
    force: true,
    steps,
  });
  const ok = Boolean(result && result.ok);
  await evalFirstOk(wc, paintScript(field.id, ok ? 'green' : 'red'));
  if (ok) {
    rememberAnswer(field, typed, {
      source: 'accept',
      classId: chosen,
    });
    const learnedSteps = Array.isArray(steps) && steps.length ? steps : genericReplaySteps(field, typed, result);
    if (learnedSteps && learnedSteps.length) {
      learnFromAct(tab, field, typed, {
        steps: completeReplaySteps(
          field,
          foldPokeIntoSteps(learnedSteps, result && result.strategy),
          result && result.strategy
        ),
        selector: recipe && recipe.selector,
      });
    } else {
      learnNoticePoke(tab, field, typed, result, { recipe, selector: recipe && recipe.selector });
    }
    recordWin(fp, (result && result.strategy) || 'native_value');
    field.current = (result && result.value) || typed;
    field.intended = typed;
    field.magnetState = 'green';
    markReviewAccepted(tab, field, fieldId, typed);
    tab.reviewCounts = { ...(tab.reviewCounts || {}), accepted: ((tab.reviewCounts || {}).accepted || 0) + 1 };
    await focusNextAccept(wc, tab, fieldId);
    return { ok: true, result, learned: true };
  }
  if (field.type === 'checkbox' || field.type === 'radio') {
    return { ok: false, error: (result && result.reason) || 'unverified', result };
  }
  if (result && (result.reason === 'missing' || result.reason === 'unverified' || result.stepsFailed)) {
    try {
      const shot = await runReviewPass(wc, tab, {
        residuals: [{ ...field, residual: result.reason || 'unverified', intended: typed, current: result.value || '' }],
        allowRuns: true,
        instruction: `Value Accept failed for "${field.label}" (${result.reason || 'unverified'}). Propose steps or a run script.`,
      });
      return { ok: false, result, needRun: true, review: shot };
    } catch (err) {
      console.warn('[magnet] review after accept:', err.message || err);
    }
  }
  return { ok: false, result };
}

async function acceptReviewRecipe(wc, tab, { recipeId, accept }) {
  const row = ((tab && tab.review && tab.review.recipes) || []).find((r) => r.id === recipeId);
  if (!row) return { ok: false, error: 'no-recipe' };
  if (!accept) {
    row.dismissed = true;
    return { ok: true, dismissed: true };
  }
  try {
    const reviewField = fieldForReviewRow(tab, row);
    const learned = learnRecipe({
      label: row.label,
      label_includes: row.label_includes && row.label_includes.length ? row.label_includes : undefined,
      steps: row.steps && row.steps.length ? row.steps : undefined,
      shape: reviewField && reviewField.shape,
    });
    const typed = row.value || '';
    if (wc && reviewField && typed) {
      const filled = await acceptReviewFill(wc, tab, {
        fieldId: reviewField.id,
        value: typed,
        steps: row.steps,
        label: row.label || reviewField.label,
      });
      if (filled && filled.ok) {
        row.accepted = true;
        return { ok: true, learned, filled };
      }
      return {
        ok: false,
        learned,
        error: (filled && filled.error) || (filled && filled.result && filled.result.reason) || 'fill-failed',
        result: filled && filled.result,
      };
    }
    row.accepted = true;
    return { ok: true, learned };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

async function acceptReviewRun(wc, tab, { fieldId, source, save, saveWithoutVerify }) {
  const field = (tab.debugFields || []).find((f) => f.id === fieldId);
  if (!field) return { ok: false, error: 'no-field' };
  const script = String(source || '');
  if (!script.trim()) return { ok: false, error: 'empty-script' };
  const intended =
    (tab.review && tab.review.fills && tab.review.fills.find((f) => f.id === fieldId) && tab.review.fills.find((f) => f.id === fieldId).value) ||
    field.intended ||
    '';
  const result = await driveField(wc, field, intended, { runSource: script });
  const current = (result && result.value) || '';
  const verified = Boolean(intended) && String(current).toLowerCase().includes(String(intended).toLowerCase());
  const canSave = Boolean(save) && (verified || saveWithoutVerify);
  if (canSave) {
    const url = (tab.meta && tab.meta.url) || '';
    learnFromAct(tab, field, intended || current, {
      run: { source: script, hash: hashSource(script) },
    });
    if (saveWithoutVerify && !verified) {
      appendAttempt({
        url,
        save_without_verify: true,
        fieldId,
        label: field.label,
      });
    }
  }
  if (tab.review && tab.review.runs) {
    const row = tab.review.runs.find((r) => r.id === fieldId);
    if (row) {
      row.source = script;
      row.accepted = Boolean(result && result.ok);
    }
  }
  await evalFirstOk(wc, paintScript(field.id, result && result.ok ? 'green' : 'red'));
  return { ok: Boolean(result && result.ok), result, saved: canSave, verified };
}

async function rewriteReviewRun(wc, tab, { fieldId, instruction }) {
  const field = (tab.debugFields || []).find((f) => f.id === fieldId);
  if (!field) return { ok: false, error: 'no-field' };
  const shot = await runReviewPass(wc, tab, {
    residuals: [field],
    allowRuns: true,
    instruction: instruction || `Rewrite a run script for "${field.label}".`,
  });
  return { ok: true, review: shot };
}

async function harvestSweepStaticFields(wc, tab) {
  if (!wc) return [];
  let payloads = [];
  try {
    const raw = await evalFirstOk(wc, harvestSweepScript());
    payloads = Array.isArray(raw) ? raw : [];
  } catch (_) {
    payloads = [];
  }
  const out = [];
  for (const payload of payloads) {
    if (!payload || !payload.id) continue;
    const row = await harvestStaticField(wc, tab, payload);
    if (row && row.ok) out.push(row);
  }
  return out;
}

async function harvestStaticField(wc, tab, payload) {
  const field = (tab.debugFields || []).find((f) => f.id === payload.id);
  if (!field) return { ok: false };
  if (tab.fillRecord && tab.fillRecord.status === 'recording' && tab.fillRecord.fieldId === payload.id) {
    return { ok: false, skipped: 'recording' };
  }
  if (field.route === 'employment' || field.route === 'needs_llm') return { ok: false, skipped: field.route };
  const value = String((payload && payload.value) || '').trim();
  if (!value) return { ok: false, skipped: 'empty' };
  if (field.prefill && value === String(field.prefill).trim() && !field.userValue) {
    return { ok: false, skipped: 'prefill' };
  }
  field.userValue = value;
  field.current = value;
  rememberAnswer(field, value, { source: 'harvest' });
  learnFromAct(tab, field, value, {
    selector: payload.selector,
    steps:
      payload.steps && payload.steps.length
        ? payload.steps
        : genericReplaySteps(field, value, { strategy: field.reactSelect ? 'react_select' : '' }),
  });
  if (tab.review && tab.review.fills) {
    const row = tab.review.fills.find((f) => f.id === field.id);
    if (row) {
      row.accepted = true;
      row.value = value;
    }
  }
  tab.reviewCounts = { ...(tab.reviewCounts || {}), harvested: ((tab.reviewCounts || {}).harvested || 0) + 1 };
  return { ok: true, harvested: true, value };
}

async function answerReviewAsk(wc, tab, { id, answer }) {
  const text = String(answer || '').trim();
  if (!text) return { ok: false, error: 'empty' };
  if (tab.review && tab.review.asks) {
    const ask = (id && tab.review.asks.find((a) => a.id === id && !a.answered)) || tab.review.asks.find((a) => !a.answered);
    if (ask) {
      ask.answered = true;
      ask.answer = text;
      if (ask.id) {
        return acceptReviewFill(wc, tab, { fieldId: ask.id, value: text });
      }
    }
  }
  const focused = focusedStaticField(tab);
  if (focused) return acceptReviewFill(wc, tab, { fieldId: focused.id, value: text });
  return { ok: true, stored: true };
}

function openFlagReview(tab, out) {
  if (!out || !out.open_review) return;
  const field = (tab.debugFields || []).find((f) => f.id === out.fieldId);
  tab.reviewFocus = out.fieldId;
  const previous = out.previous || (field && (field.current || field.value)) || '';
  const intended = field && String(field.intended || '').trim();
  const fill = {
    id: out.fieldId,
    value: intended || previous,
    previous,
    reason: out.reopen_run
      ? 'ATS didn’t notice — Accept a value or reopen the script.'
      : 'Magnet put a different value',
    gate: out.reopen_run ? 'couldnt-land' : 'wrong-intended',
    label: out.label || (field && field.label) || out.fieldId,
    accepted: false,
    type: field && field.type,
    options: (field && field.options) || [],
    shape: field && field.shape,
    steps: field ? fillStepsFor(field) : [],
  };
  const runs =
    out.reopen_run && out.runSource
      ? decorateRuns(
          [{ id: out.fieldId, source: out.runSource, explain: 'Saved script for this field. Edit if needed.', why_not_steps: 'Reopened from flag.' }],
          tab.debugFields
        )
      : [];
  tab.review = mergeReview(tab.review, { reply: fill.reason, fills: [fill], asks: [], runs, at: new Date().toISOString() });
}

/**
 * Autofill pipeline. Upload only when hooks.upload is set. Never Next/Submit.
 */
async function runAutofill(wc, tab, hooks = {}) {
  const onStep = hooks.onStep || (() => {});
  const skipReview = Boolean(hooks.skipReview);
  const skipEssays = Boolean(hooks.skipEssays);
  tab.review = { kind: 'review', fills: [], asks: [], runs: [], recipes: [], reply: '' };
  tab.reviewNotes = [];
  tab.reviewFieldChats = {};
  tab.skippedReview = false;
  try {
  throwIfAborted(tab);
  const found = await discoverFields(wc, tab, { ...hooks, fill: true });
  throwIfAborted(tab);
  try {
    await evalFirstOk(wc, PAINT_MISSED_SCRIPT);
  } catch (_) {}

  const findings = tab.jd && tab.jd.findings;
  const canaryPhrases = found.canaryPhrases || (findings && findings.canaryPhrases) || [];
  const audit = auditFields(found.debugFields, { canaryPhrases, findings });
  tab.audit = audit;
  tab.debugFields = audit.fields;

  let residuals = await retryKnownResiduals(wc, tab, audit.residuals || [], found);
  residuals = filterAskable(collapseChoiceResiduals(residuals, tab.debugFields), { afterRetry: true });
  tab.skippedReview = residuals.length === 0;

  const residualIds = new Set(residuals.map((f) => f.id));
  const uncertainties = (tab.debugFields || [])
    .filter((f) => f.uncertainty && f.uncertainty.reason)
    .filter((f) => f.magnetState !== 'green')
    .filter((f) => !valuesEqual(f.intended || f.profileValue, f.current, f))
    .filter((f) => reviewGate(f, { afterRetry: true }).ask)
    .filter((f) => !residualIds.has(f.id))
    .map((f) => ({
      id: f.id,
      label: f.label,
      reason: f.uncertainty.reason,
      intended: f.uncertainty.intended || f.profileValue,
      picked: f.uncertainty.picked || f.current,
    }));
  if (uncertainties.length) {
    const unsureFills = uncertainties.map((u) => ({
      id: u.id,
      value: u.picked || u.intended || '',
      reason: u.reason,
      gate: 'fuzzy',
      label: u.label,
      intended: u.intended,
      picked: u.picked,
      accepted: false,
    }));
    tab.review = mergeReview(tab.review, {
      reply: '',
      fills: unsureFills,
      asks: [],
      runs: [],
      uncertainties: [],
      at: new Date().toISOString(),
    });
  }

  const counts = tab.reviewCounts || { proposed: 0, accepted: 0, harvested: 0 };
  let reviewShot = null;
  let stopAfterReview = false;
  const parallel = Boolean(hooks.parallelReviewEssays);

  async function doReview() {
    if (seedResidualReview(tab, residuals)) {
      onStep(parallel && tab.essayBusy ? tab.autofillStep || 'Essays' : 'Review', {
        detail: reviewEssayDetail(tab),
      });
    }
    if (!residuals.length) {
      tab.review = tab.review || { kind: 'review', fills: [], asks: [], runs: [], recipes: [], reply: '' };
      return null;
    }
    try {
      const shot = await runReviewPass(wc, tab, {
        residuals,
        allowRuns: false,
        onStep,
      });
      counts.proposed = (shot.fills || []).length;
      return shot;
    } catch (err) {
      const n = seedResidualReview(tab, residuals);
      if (n) counts.proposed = n;
      if (isReviewCancelled(err)) {
        tab.skippedReview = true;
        stopAfterReview = tab.reviewCancelMode === 'stop' || Boolean(tab.fillAbort && tab.fillAbort.signal.aborted);
        onStep(parallel && tab.essayBusy && !stopAfterReview ? 'Essays' : 'Review', {
          detail: reviewEssayDetail(tab),
          toast: stopAfterReview
            ? 'Stopped'
            : parallel
              ? 'Cancelled leftover review'
              : 'Skipped review — drafting essays',
        });
      } else if (isFillCancelled(err)) {
        throw err;
      } else {
        console.warn('[magnet] review:', err.message || err);
        tab.reviewError = String(err.message || err);
      }
      return null;
    }
  }

  const unsureReply = uncertainties.length
    ? uncertainties.map((u) => `Unsure · ${u.label}: ${u.reason}`).join('\n')
    : '';

  let drafted = { reply: '', drafts: [], sent: null, received: null };
  if (skipReview) {
    tab.skippedReview = true;
    if (seedResidualReview(tab, residuals)) {
      onStep('Review', { detail: '' });
    }
  } else if (parallel && !skipEssays) {
    const reviewP = doReview().then((shot) => {
      if (tab.autofillStatus === 'running') {
        onStep(tab.essayBusy ? 'Essays' : tab.autofillStep || 'Review', {
          detail: reviewEssayDetail(tab),
        });
      }
      return shot;
    });
    const essayP = draftEssays(wc, tab, found.essayFields, hooks).then((result) => {
      if (tab.reviewAbort) {
        onStep(tab.autofillStep || 'Review', { detail: reviewEssayDetail(tab) });
      }
      return result;
    });
    const [shot, essayResult] = await Promise.all([reviewP, essayP]);
    reviewShot = shot;
    drafted = essayResult;
  } else {
    reviewShot = await doReview();
  }

  tab.reviewCounts = counts;
  appendAttempt({
    url: found.url,
    fieldCount: found.fieldCount,
    essays: found.essayFields.length,
    company: tab.meta && tab.meta.name,
    fields: auditLogFields(audit),
    static_ok: audit.static_ok,
    static_total: audit.static_total,
    proposed: counts.proposed,
    accepted: counts.accepted,
    harvested: counts.harvested,
  });

  if (stopAfterReview || (drafted && drafted.cancelled)) {
    onStep('Done', { detail: '' });
    try {
      await harvestTabAnswers(wc, tab);
    } catch (_) {}
    return {
      ok: true,
      fieldCount: found.fieldCount,
      essays: 0,
      reply: unsureReply,
      drafts: [],
      sent: null,
      received: null,
      jd: tab.jd,
      debugFields: found.debugFields,
      kind: reviewShot ? 'review' : undefined,
      cancelled: true,
    };
  }
  if (!skipEssays && !parallel) {
    throwIfAborted(tab);
    drafted = await draftEssays(wc, tab, found.essayFields, hooks);
    if (drafted && drafted.cancelled) {
      onStep('Done', { detail: '' });
      return {
        ok: true,
        cancelled: true,
        fieldCount: found.fieldCount,
        essays: 0,
        reply: '',
        drafts: [],
        jd: tab.jd,
        debugFields: found.debugFields,
      };
    }
  }
  onStep('Done', { detail: '' });
  const essayStatus = essayAutofillStatus({
    skipEssays,
    essayFields: found.essayFields,
    drafted,
  });
  const autofillResult = {
    ok: essayStatus.ok,
    fieldCount: found.fieldCount,
    essays: essayStatus.essays,
    ...chatFromAutofill({ ...(drafted || {}), reply: essayStatus.reply }),
    jd: tab.jd,
    debugFields: found.debugFields,
  };
  if (essayStatus.error) autofillResult.error = essayStatus.error;
  try {
    const harvested = await harvestTabAnswers(wc, tab);
    autofillResult.answers = harvested.count;
  } catch (err) {
    console.warn('[magnet] harvest:', (err && err.message) || err);
  }
  return autofillResult;
  } catch (err) {
    if (isFillCancelled(err)) {
      onStep('Done', { detail: '' });
      return { ok: true, cancelled: true, drafts: [], reply: '', jd: tab.jd, debugFields: tab.debugFields || [] };
    }
    throw err;
  }
}

/** Essay button / chat: classify only, then talk and optionally draft needs_llm fields. */
async function runEssays(wc, tab, hooks = {}) {
  const onStep = hooks.onStep || (() => {});
  const instruction = String(hooks.instruction || '').trim();
  try {
    throwIfAborted(tab);
    const found = wc
      ? await discoverFields(wc, tab, { ...hooks, fill: false })
      : { essayFields: [], debugFields: [], fieldCount: 0, url: '' };
    throwIfAborted(tab);
    const targets = (() => {
      applyEssayOverride(tab, found, instruction);
      return pickEssayTargets(found, hooks.fieldIds);
    })();
    if (!targets.length && !instruction) {
      onStep('Done', { detail: '' });
      return {
        ok: true,
        essays: 0,
        empty: true,
        reply: 'No essay fields on this page.',
        drafts: [],
        jd: tab.jd,
        debugFields: found.debugFields,
      };
    }
    const drafted = await draftEssays(wc, tab, targets, hooks);
    if (drafted && drafted.cancelled) {
      onStep('Done', { detail: '' });
      return { ok: true, cancelled: true, essays: 0, drafts: [], reply: '', jd: tab.jd, debugFields: found.debugFields };
    }
    appendAttempt({
      url: found.url,
      fieldCount: found.fieldCount,
      essays: targets.length,
      company: tab.meta && tab.meta.name,
      essaysOnly: true,
    });
    onStep('Done', { detail: '' });
    let answers = 0;
    try {
      answers = (await harvestTabAnswers(wc, tab)).count;
    } catch (err) {
      console.warn('[magnet] harvest:', (err && err.message) || err);
    }
    return {
      ok: Boolean(drafted.ok),
      essays: drafted.essays,
      answers,
      empty: Boolean(drafted.empty),
      reply: drafted.reply || '',
      drafts: drafted.drafts || [],
      asks: drafted.asks || [],
      tools: drafted.tools || [],
      sent: drafted.sent || null,
      received: drafted.received || null,
      jd: tab.jd,
      debugFields: found.debugFields,
    };
  } catch (err) {
    if (isFillCancelled(err)) {
      onStep('Done', { detail: '' });
      return { ok: true, cancelled: true, essays: 0, drafts: [], reply: '', jd: tab && tab.jd, debugFields: (tab && tab.debugFields) || [] };
    }
    throw err;
  }
}

const GREENHOUSE_UPLOADER_SCRIPT = `(() => {
  const input = document.querySelector('input#resume, input[name="resume"][type="file"]');
  if (!input) return { ready: false, reason: 'no-input' };
  const seen = new Set();
  const dig = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 5 || node.nodeType) return null;
    if (seen.has(node)) return null;
    seen.add(node);
    const uploaders = node.uploaders || (node.uploadManager && node.uploadManager.uploaders);
    if (uploaders && uploaders.resume && typeof uploaders.resume.uploadFile === 'function') return true;
    const vals = Object.values(node);
    for (let i = 0; i < vals.length && i < 30; i++) {
      if (dig(vals[i], depth + 1)) return true;
    }
    return null;
  };
  const fiberKey = Object.keys(input).find((k) => k.startsWith('__reactFiber$'));
  let fiber = fiberKey ? input[fiberKey] : null;
  const fibers = new Set();
  while (fiber && !fibers.has(fiber)) {
    fibers.add(fiber);
    if (dig(fiber.memoizedProps, 0) || dig(fiber.memoizedState, 0) || dig(fiber.stateNode, 0)) {
      return { ready: true };
    }
    fiber = fiber.return;
  }
  return { ready: false };
})()`;

const GREENHOUSE_RESUME_CHANGE_SCRIPT = `(() => {
  const input = document.querySelector('input#resume, input[name="resume"][type="file"]');
  if (!input || !input.files || !input.files.length) return { ok: false, error: 'no-file' };
  const key = Object.keys(input).find((k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
  const props = key ? input[key] : null;
  if (!props || typeof props.onChange !== 'function') return { ok: false, error: 'no-onchange' };
  try {
    props.onChange({ target: input, currentTarget: input });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  const blob = document.body ? document.body.innerText || '' : '';
  if (/cannot read properties of undefined \\(reading 'uploadFile'\\)/i.test(blob)) {
    return { ok: false, error: "Cannot read properties of undefined (reading 'uploadFile')" };
  }
  return { ok: true };
})()`;

const FIND_FILE_SCRIPT = `(() => {
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  const visible = inputs.filter((el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (el.disabled) return false;
    if (st.display === 'none') return false;
    return true;
  });
  const named = (el) => /resume|cv|upload/i.test(el.name + el.id + (el.getAttribute('aria-label') || ''));
  const el = visible.find(named) || inputs.find(named) || visible[0] || inputs[0];
  if (!el) return { ok: false };
  const label = (el.closest('label') && el.closest('label').innerText) || '';
  if (/[.](pdf|docx?)/i.test(label) || el.files && el.files.length) {
    return { ok: true, already: true, selector: 'input[type="file"]' };
  }
  if (!el.id) el.setAttribute('data-magnet-file', '1');
  return {
    ok: true,
    already: false,
    selector: el.id ? ('#' + CSS.escape(el.id)) : '[data-magnet-file="1"]',
  };
})()`;

const CLICK_UPLOAD_SCRIPT = `(() => {
  const re = /upload (resume|cv|file)|attach (resume|cv)/i;
  const el = [...document.querySelectorAll('button, a, [role="button"], label')].find((n) =>
    re.test((n.innerText || n.getAttribute('aria-label') || ''))
  );
  if (!el) return { ok: false };
  el.click();
  return { ok: true };
})()`;

const VERIFY_FILE_SCRIPT = `(() => {
  const t = document.body.innerText || '';
  return { text: t.slice(0, 8000) };
})()`;

module.exports = {
  runAutofill,
  runEssays,
  ensureTabJd,
  openApplySurface,
  waitForPageChange,
  waitAfterApplyClick,
  evalAllFrames,
  evalFirstOk,
  loadSession,
  saveSession,
  sessionPath,
  retryField,
  retryReviewField,
  snapshotPage,
  syncEssayFinals,
  harvestApplicantEssays,
  harvestTabAnswers,
  harvestStaticField,
  harvestSweepStaticFields,
  acceptReviewFill,
  acceptReviewRecipe,
  acceptReviewRun,
  rewriteReviewRun,
  answerReviewAsk,
  reviewFieldChat,
  learnReviewSteps,
  startFillRecord,
  stopFillRecord,
  confirmFillRecord,
  proveFillSteps,
  fillStepsFor,
  pendingReview,
  focusedStaticField,
  leftoversForChat,
  chatDigest,
  reviewDigest,
  chatFromAutofill,
  harvestForEssayTurn,
  openFlagReview,
  cancelReview,
  cancelFill,
  attachFillAbort,
  isFillCancelled,
  reviewEssayDetail,
  LEFTOVER_REVIEW_DETAIL,
  REVIEW_AND_ESSAYS_DETAIL,
  MATCHING_DETAIL,
  isAgeRangeField,
  parseAgeFromText,
  isPaceTextField,
  wantsPaceType,
  leftoverStatics,
  leftoverClosedChoice,
  seedResidualReview,
  persistFieldFact,
  rememberAnswer,
  collapseChoiceResiduals,
  applyReviewLearning,
  persistReviewRecipes,
  stampInferredFills,
  applyInferredReviewFills,
  ESSAY_PLACEHOLDER: 'Let me think on this…',
  pickEssayTargets,
  scrubCardIds,
  applyMirrorSave,
  FIND_FILE_SCRIPT,
  GREENHOUSE_UPLOADER_SCRIPT,
  GREENHOUSE_RESUME_CHANGE_SCRIPT,
  essayAutofillStatus,
  CLICK_UPLOAD_SCRIPT,
  VERIFY_FILE_SCRIPT,
  resolveValue,
  hydrateSelectOptions,
  fillChain,
};
