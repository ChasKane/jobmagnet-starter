const facts = require('./profile-facts');

function clone(doc) {
  return JSON.parse(JSON.stringify(doc || {}));
}

function setDeep(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== 'object' || Array.isArray(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

function answerKey(classId) {
  return String(classId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeClassId(classId) {
  const raw = String(classId || '').trim();
  if (!raw) return '';
  if (raw.includes(':')) return raw;
  return require('./question-class').classifyQuestion({ label: raw }).class || raw;
}

function asBool(value) {
  if (value === true || value === 1 || value === '1' || /^true|yes$/i.test(String(value))) return true;
  if (value === false || value === 0 || value === '0' || /^false|no$/i.test(String(value))) return false;
  return null;
}

function asInt(value, min, max) {
  const n = Number(String(value == null ? '' : value).replace(/[$,]/g, ''));
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function mappedWrite(classId, value) {
  const id = String(classId || '').trim();
  if (id.startsWith('years:')) {
    const skill = id.slice(6);
    if (!skill || skill === 'unknown') return null;
    const n = asInt(String(value).replace(/[^\d.-]/g, ''), 0, 40);
    if (n == null) return null;
    return { path: `skills.${skill}`, value: n, parts: ['skills', skill, 'years'], allowlisted: true };
  }
  if (id === 'salary:base') {
    const n = asInt(value, 10000, 1000000);
    if (n == null) return null;
    return { path: 'work.compensation.target_usd', value: n, parts: ['work', 'compensation', 'target_usd'], allowlisted: true };
  }
  if (id === 'salary:history') {
    const n = asInt(value, 0, 1000000);
    if (n == null) return null;
    return { path: 'work.compensation.history_usd', value: n, parts: ['work', 'compensation', 'history_usd'], allowlisted: true };
  }
  if (id === 'age:range') {
    const n = asInt(String(value).replace(/[^\d.-]/g, ''), 18, 80);
    if (n == null) return null;
    return { path: 'identity.age', value: n, parts: ['identity', 'age'], allowlisted: true };
  }
  if (id === 'identity:phone') {
    const s = String(value || '').replace(/\s+/g, ' ').trim();
    const digits = s.replace(/\D/g, '');
    if (!s || digits.length < 7 || digits.length > 15 || s.length > 32) return null;
    return { path: 'identity.phone', value: s, parts: ['identity', 'phone'], allowlisted: true };
  }
  if (id === 'sponsorship') {
    const b = asBool(value);
    if (b == null) return null;
    return {
      path: 'work.requires_sponsorship_now_or_future',
      value: b,
      parts: ['work', 'requires_sponsorship_now_or_future'],
      allowlisted: true,
    };
  }
  if (id === 'work_auth:us') {
    const b = asBool(value);
    if (b == null) return null;
    return {
      path: 'work.legally_authorized_to_work_us',
      value: b,
      parts: ['work', 'legally_authorized_to_work_us'],
      allowlisted: true,
    };
  }
  if (id === 'eeo:orientation') {
    const s = String(value || '').trim();
    if (!s || s.length > 80) return null;
    return { path: 'eeo.orientation', value: s, parts: ['eeo', 'orientation'], allowlisted: true };
  }
  if (id === 'eeo:ethnicity') {
    const s = String(value || '').trim();
    if (!s || s.length > 80) return null;
    return { path: 'eeo.ethnicity', value: s, parts: ['eeo', 'ethnicity'], allowlisted: true };
  }
  if (id === 'eeo:gender') {
    const s = String(value || '').trim();
    if (!s || s.length > 80) return null;
    return { path: 'eeo.gender.prefer', value: s, parts: ['eeo', 'gender', 'prefer'], allowlisted: true };
  }
  if (id === 'eeo:transgender') {
    const yn = asBool(value);
    if (yn == null) return null;
    return { path: 'eeo.transgender', value: yn ? 'yes' : 'no', parts: ['eeo', 'transgender'], allowlisted: true };
  }
  if (id === 'eeo:veteran') {
    const yn = asBool(value);
    if (yn == null) return null;
    return { path: 'eeo.veteran', value: yn ? 'yes' : 'no', parts: ['eeo', 'veteran'], allowlisted: true };
  }
  if (id === 'eeo:disability') {
    const yn = asBool(value);
    if (yn == null) return null;
    return { path: 'eeo.disability', value: yn ? 'yes' : 'no', parts: ['eeo', 'disability'], allowlisted: true };
  }
  if (id === 'consent:recording') {
    let b = asBool(value);
    if (b == null) {
      const s = String(value || '');
      if (/opt out|do not consent|unrecorded/i.test(s)) b = false;
      else if (/i agree|i consent|acknowledge|^\s*yes\b/i.test(s)) b = true;
    }
    if (b == null) return null;
    return {
      path: 'work.interview_recording_consent',
      value: b,
      parts: ['work', 'interview_recording_consent'],
      allowlisted: true,
    };
  }
  if (id === 'other:first name') {
    const s = String(value || '').trim();
    if (!s || s.length > 80) return null;
    return { path: 'identity.first_name', value: s, parts: ['identity', 'first_name'], allowlisted: false };
  }
  if (id === 'other:last name') {
    const s = String(value || '').trim();
    if (!s || s.length > 80) return null;
    return { path: 'identity.last_name', value: s, parts: ['identity', 'last_name'], allowlisted: false };
  }
  if (id === 'other:email') {
    const s = String(value || '').trim();
    if (!s || !s.includes('@') || s.length > 80) return null;
    return { path: 'identity.email', value: s, parts: ['identity', 'email'], allowlisted: false };
  }
  return null;
}

function factValueForClass(doc, classId) {
  const id = String(classId || '').trim();
  const skills = (doc && doc.skills) || {};
  const identity = (doc && doc.identity) || {};
  const work = (doc && doc.work) || {};
  const pay = work.compensation || {};
  if (id.startsWith('years:')) {
    const skill = id.slice(6);
    const n = skills[skill] && skills[skill].years;
    return n == null || n === '' ? null : String(n);
  }
  if (id === 'salary:base') return pay.target_usd == null ? null : String(pay.target_usd);
  if (id === 'salary:history') return pay.history_usd == null ? null : String(pay.history_usd);
  if (id === 'age:range') return identity.age == null ? null : String(identity.age);
  if (id === 'identity:phone') return identity.phone ? String(identity.phone) : null;
  if (id === 'identity:country') {
    const mail = identity.mailing_address || {};
    const country = identity.country || mail.country || '';
    return country && !/^\+?\d[\d\s().-]{6,}$/.test(String(country).trim()) ? String(country) : null;
  }
  if (id === 'referral' || id === 'conflict:employer') return 'No';
  if (id === 'location:in_us') return 'Yes';
  if (id === 'sponsorship') {
    if (work.requires_sponsorship_now_or_future == null) return null;
    return work.requires_sponsorship_now_or_future ? 'Yes' : 'No';
  }
  if (id === 'work_auth:us') {
    if (work.legally_authorized_to_work_us == null) return null;
    return work.legally_authorized_to_work_us ? 'Yes' : 'No';
  }
  if (id === 'consent:recording') return work.interview_recording_consent === false ? 'No' : 'Yes';
  const eeo = (doc && doc.eeo) || {};
  if (id === 'eeo:orientation') return eeo.orientation ? String(eeo.orientation) : null;
  if (id === 'eeo:ethnicity') {
    const eth = eeo.ethnicity;
    if (eth == null || eth === '') return null;
    if (/hispanic|latino/i.test(String(eth))) return null;
    return String(eth).replace(/_/g, ' ');
  }
  if (id === 'eeo:race') {
    const races = Array.isArray(eeo.race) ? eeo.race : [];
    const race = races[0];
    return race ? String(race).replace(/_/g, ' ') : null;
  }
  if (id === 'eeo:gender') {
    const g = eeo.gender || {};
    const key = g.prefer || g.fallback || g.last_resort;
    if (!key) return null;
    if (key === 'nonbinary') return 'Non-binary';
    if (key === 'prefer_not_to_answer') return 'prefer not to answer';
    if (key === 'male') return 'Male';
    if (key === 'female') return 'Female';
    return String(key);
  }
  if (id === 'eeo:transgender') {
    if (eeo.transgender == null || eeo.transgender === '') return null;
    return /^(yes|true)$/i.test(String(eeo.transgender)) ? 'Yes' : 'No';
  }
  if (id === 'eeo:veteran') {
    if (eeo.veteran == null || eeo.veteran === '') return null;
    return /^(yes|true)$/i.test(String(eeo.veteran)) ? 'Yes' : 'No';
  }
  if (id === 'eeo:disability') {
    if (eeo.disability == null || eeo.disability === '') return null;
    return /^(yes|true)$/i.test(String(eeo.disability)) ? 'Yes' : 'No';
  }
  if (id === 'location:work_from') {
    const city = identity.based_city;
    const st = identity.based_state_code || identity.based_state;
    if (!city) return null;
    return st ? `${city}, ${st}` : String(city);
  }
  if (id === 'location:general') return identity.based_city ? String(identity.based_city) : null;
  if (id === 'other:first name') return identity.first_name ? String(identity.first_name) : null;
  if (id === 'other:last name') return identity.last_name ? String(identity.last_name) : null;
  if (id === 'other:email') return identity.email ? String(identity.email) : null;
  return null;
}

function answersOf(doc) {
  const raw = doc && doc.answers;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function phoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function applyConfirm(doc, classId, value, extra = {}) {
  const id = normalizeClassId(classId);
  const text = String(value == null ? '' : value).trim();
  if (!id || !text) return { doc: doc || {}, row: null, writes: [] };
  const next = clone(doc || {});
  const mapped = mappedWrite(id, text);
  const writes = [];
  // A form harvest must not replace the canonical phone with a different number.
  // Greenhouse autofill has been writing a stale 206 number back onto the profile.
  if (mapped && mapped.path === 'identity.phone' && /^(harvest|autofill|wrong_value)$/.test(String(extra.source || ''))) {
    const identity = (doc && doc.identity) || {};
    const current = phoneDigits(identity.phone || identity.phone_national);
    const incoming = phoneDigits(mapped.value);
    if (current && incoming && current !== incoming) return { doc: doc || {}, row: null, writes: [] };
  }
  if (mapped) {
    setDeep(next, mapped.parts, mapped.value);
    writes.push(mapped);
  }
  const key = answerKey(id);
  const answers = { ...answersOf(next) };
  if (mapped) {
    delete answers[key];
    if (Object.keys(answers).length) next.answers = answers;
    else delete next.answers;
    const row = {
      class: id,
      value: String(mapped.value),
      confidence: extra.confidence || 'confirmed',
      source: extra.source || 'profile',
      label: extra.label || undefined,
    };
    return { doc: next, row, writes };
  }
  const row = {
    class: id,
    value: text,
    confidence: extra.confidence || 'confirmed',
    source: extra.source || 'accept',
    confirmed_at: extra.confirmed_at || new Date().toISOString(),
    label: extra.label || undefined,
  };
  answers[key] = row;
  next.answers = answers;
  return { doc: next, row, writes };
}

function applyContradict(doc, classId, extra = {}) {
  const id = normalizeClassId(classId);
  if (!id) return { doc: doc || {}, row: null };
  const next = clone(doc || {});
  const key = answerKey(id);
  const answers = { ...answersOf(next) };
  const prev = answers[key] && typeof answers[key] === 'object' ? answers[key] : { class: id };
  const row = {
    ...prev,
    class: id,
    confidence: 'contradicted',
    source: extra.source || 'flag',
    contradicted_at: extra.contradicted_at || new Date().toISOString(),
    label: extra.label || prev.label || undefined,
  };
  answers[key] = row;
  next.answers = answers;
  return { doc: next, row };
}

function readConfirmation(doc, classId) {
  const id = normalizeClassId(classId);
  if (!id) return null;
  const overlay = answersOf(doc)[answerKey(id)] || null;
  if (overlay && overlay.confidence === 'contradicted') return overlay;
  const fact = factValueForClass(doc, id);
  if (fact != null && String(fact).trim() !== '') {
    return { class: id, value: String(fact).trim(), confidence: 'confirmed', source: 'profile' };
  }
  if (overlay && overlay.confidence !== 'contradicted' && String(overlay.value || '').trim()) return overlay;
  return null;
}

function listAnswers(doc) {
  return Object.values(answersOf(doc)).filter((row) => row && row.class);
}

function persistApplied(next, writes) {
  for (const write of writes || []) {
    if (write.allowlisted) facts.applyUpdates([{ path: write.path, value: write.value }]);
    else facts.writeTrusted(write.path, write.value);
  }
  const answers = answersOf(next);
  facts.setTopLevel('answers', Object.keys(answers).length ? answers : null);
}

function invalidate() {
  facts.invalidate();
}

let overrideDoc = null;

function setProfileDoc(doc) {
  overrideDoc = doc && typeof doc === 'object' ? doc : null;
  return overrideDoc;
}

function currentDoc() {
  if (overrideDoc) return overrideDoc;
  try {
    return facts.load();
  } catch {
    return {};
  }
}

function getConfirmation(classId) {
  return readConfirmation(currentDoc(), classId);
}

function confirmClass(classId, value, extra = {}) {
  const { doc, row, writes } = applyConfirm(currentDoc(), classId, value, extra);
  if (!row) return null;
  persistApplied(doc, writes);
  return row;
}

function contradictClass(classId, extra = {}) {
  const { doc, row } = applyContradict(currentDoc(), classId, extra);
  if (!row) return null;
  persistApplied(doc, []);
  return row;
}

function confirmationsFile() {
  return facts.profileFile();
}

module.exports = {
  confirmationsFile,
  invalidate,
  setProfileDoc,
  getConfirmation,
  confirmClass,
  contradictClass,
  applyConfirm,
  applyContradict,
  readConfirmation,
  listAnswers,
  answerKey,
  normalizeClassId,
};
