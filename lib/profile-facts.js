const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_PROFILE = path.join(__dirname, '..', 'knowledge', 'applicant-profile.yaml');

const SCALAR = new Map([
  ['identity.age', { type: 'int', min: 18, max: 80 }],
  ['identity.phone', { type: 'string' }],
  ['work.compensation.target_usd', { type: 'int', min: 10000, max: 1000000 }],
  ['work.compensation.history_usd', { type: 'int', min: 0, max: 1000000 }],
  ['work.remote', { type: 'bool' }],
  ['work.willing_to_relocate', { type: 'bool' }],
  ['work.legally_authorized_to_work_us', { type: 'bool' }],
  ['work.requires_sponsorship_now_or_future', { type: 'bool' }],
  ['work.interview_recording_consent', { type: 'bool' }],
  ['eeo.gender.prefer', { type: 'string' }],
  ['eeo.transgender', { type: 'yesno' }],
  ['eeo.veteran', { type: 'yesno' }],
  ['eeo.disability', { type: 'yesno' }],
  ['eeo.ethnicity', { type: 'string' }],
  ['eeo.orientation', { type: 'string' }],
]);

const SKIP_SKILL_TOKENS = new Set([
  'age',
  'i',
  'it',
  'my',
  'the',
  'a',
  'an',
  'years',
  'year',
  'salary',
  'pay',
  'comp',
  'target',
  'old',
  'am',
  'im',
]);

let lastRaw = null;
let loadedDoc = null;

function profileFile() {
  return process.env.MAGNET_PROFILE || DEFAULT_PROFILE;
}

function invalidate() {
  lastRaw = null;
  loadedDoc = null;
  invalidateDerived();
}

function invalidateDerived() {
  try {
    require('./profile-skills').invalidate();
  } catch (_) {}
  try {
    require('./question-catalog').invalidate();
  } catch (_) {}
}

function load() {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    const doc = persist.nodeStore().getProfile() || {};
    if (doc !== loadedDoc) {
      loadedDoc = doc;
      lastRaw = yaml.dump(doc);
    }
    return clone(loadedDoc);
  }
  try {
    lastRaw = fs.readFileSync(profileFile(), 'utf8');
  } catch (_) {
    lastRaw = '';
    return {};
  }
  try {
    return yaml.load(lastRaw) || {};
  } catch (_) {
    return {};
  }
}

function rawYaml() {
  if (lastRaw == null) load();
  return lastRaw || '';
}

function topLevelKeys(raw) {
  return [...String(raw || '').matchAll(/^([a-zA-Z_][\w-]*):/gm)].map((m) => m[1]);
}

function topLevelBlockEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[a-zA-Z_][\w-]*:/.test(lines[i])) return i;
  }
  return lines.length;
}

function clone(doc) {
  return JSON.parse(JSON.stringify(doc || {}));
}

function getDeep(obj, parts) {
  let cur = obj;
  for (const key of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
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

function skillPath(dotted) {
  const m = String(dotted || '').match(/^skills\.([a-z][a-z0-9_-]{0,40})(?:\.(years|since))?$/);
  return m ? { id: m[1], field: m[2] || 'years' } : null;
}

function asInt(value, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function asBool(value) {
  if (value === true || value === 1 || value === '1' || /^true|yes$/i.test(String(value))) return true;
  if (value === false || value === 0 || value === '0' || /^false|no$/i.test(String(value))) return false;
  return null;
}

function asYesNo(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (s === 'yes' || s === 'true' || s === '1') return 'yes';
  if (s === 'no' || s === 'false' || s === '0') return 'no';
  return null;
}

function asString(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s.length > 80) return null;
  return s;
}

function coerceScalar(spec, value) {
  if (spec.type === 'int') return asInt(value, spec.min, spec.max);
  if (spec.type === 'bool') return asBool(value);
  if (spec.type === 'yesno') return asYesNo(value);
  if (spec.type === 'string') return asString(value);
  return null;
}

function normalizeOne(update) {
  if (!update || typeof update !== 'object') return null;
  if (update.employer && !update.path && !update.key) return null;
  const dotted = String(update.path || update.key || '').trim();
  if (!dotted) return null;
  const spec = SCALAR.get(dotted);
  if (spec) {
    const value = coerceScalar(spec, update.value);
    if (value == null) return null;
    return { path: dotted, parts: dotted.split('.'), value };
  }
  const skill = skillPath(dotted);
  if (!skill) return null;
  if (skill.field === 'since') {
    const year = asInt(update.value, 1970, 2100);
    if (year == null) return null;
    return { path: `skills.${skill.id}.since`, parts: ['skills', skill.id, 'since'], value: year };
  }
  if (update.value && typeof update.value === 'object' && !Array.isArray(update.value)) {
    const years = asInt(update.value.years, 0, 40);
    if (years == null) return null;
    const row = { path: `skills.${skill.id}.years`, parts: ['skills', skill.id, 'years'], value: years };
    const since = asInt(update.value.since, 1970, 2100);
    if (since == null) return [row];
    return [
      row,
      { path: `skills.${skill.id}.since`, parts: ['skills', skill.id, 'since'], value: since },
    ];
  }
  const years = asInt(update.value, 0, 40);
  if (years == null) return null;
  return { path: `skills.${skill.id}.years`, parts: ['skills', skill.id, 'years'], value: years };
}

function normalizeUpdates(updates) {
  const out = [];
  for (const update of Array.isArray(updates) ? updates : []) {
    const row = normalizeOne(update);
    if (!row) continue;
    if (Array.isArray(row)) out.push(...row);
    else out.push(row);
  }
  return out;
}

function dumpScalar(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return String(value);
  const s = String(value);
  if (/[:#]|^\s|\s$|^(true|false|null|\d)/i.test(s) && !/^(yes|no)$/i.test(s)) return JSON.stringify(s);
  return s;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function indentOf(line) {
  const m = String(line || '').match(/^ */);
  return m ? m[0].length : 0;
}

function isBlankOrComment(line) {
  return /^\s*(#|$)/.test(String(line || ''));
}

function findKey(lines, key, indent, start, end) {
  const re = new RegExp(`^${' '.repeat(indent)}${escapeRe(key)}:`);
  for (let i = start; i < end; i++) {
    if (re.test(lines[i])) return i;
    if (!isBlankOrComment(lines[i]) && indentOf(lines[i]) < indent) return -1;
  }
  return -1;
}

function blockEnd(lines, keyIdx, indent) {
  let i = keyIdx + 1;
  while (i < lines.length) {
    if (isBlankOrComment(lines[i])) {
      i += 1;
      continue;
    }
    if (indentOf(lines[i]) <= indent) break;
    i += 1;
  }
  return i;
}

function insertAt(lines, start, end) {
  let at = end;
  while (at > start && lines[at - 1] === '') at -= 1;
  return at;
}

function patchYaml(raw, dotted, value) {
  const parts = dotted.split('.');
  const lines = String(raw || '').split('\n');
  let start = 0;
  let end = lines.length;
  let indent = 0;
  for (let p = 0; p < parts.length; p++) {
    const key = parts[p];
    let idx = findKey(lines, key, indent, start, end);
    if (idx < 0) {
      const at = insertAt(lines, start, end);
      if (p === parts.length - 1) {
        lines.splice(at, 0, `${' '.repeat(indent)}${key}: ${dumpScalar(value)}`);
        return lines.join('\n');
      }
      lines.splice(at, 0, `${' '.repeat(indent)}${key}:`);
      idx = at;
      end = idx + 1;
    }
    if (p === parts.length - 1) {
      const prefix = `${' '.repeat(indent)}${key}:`;
      const rest = lines[idx].slice(prefix.length);
      if (/^\s*$/.test(rest)) {
        const childEnd = blockEnd(lines, idx, indent);
        lines.splice(idx + 1, childEnd - (idx + 1));
      }
      lines[idx] = `${prefix} ${dumpScalar(value)}`;
      return lines.join('\n');
    }
    start = idx + 1;
    end = blockEnd(lines, idx, indent);
    indent += 2;
  }
  return lines.join('\n');
}

function dumpDoc(doc) {
  return yaml.dump(doc, { lineWidth: 100, noRefs: true, sortingKeys: false });
}

function writeTrusted(dotted, value) {
  const pathStr = String(dotted || '').trim();
  if (!pathStr) return null;
  const doc = clone(load());
  const parts = pathStr.split('.');
  const previous = getDeep(doc, parts);
  if (previous === value) return { path: pathStr, value, previous, changed: false };
  setDeep(doc, parts, value);
  save(doc, [{ path: pathStr, value }]);
  return { path: pathStr, value, previous, changed: true };
}

function setTopLevel(key, value) {
  const name = String(key || '').trim();
  if (!name) return '';
  if (require('./store/mode').isSupabase()) {
    const doc = clone(load());
    const empty =
      value == null ||
      (Array.isArray(value) && !value.length) ||
      (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);
    if (empty) delete doc[name];
    else doc[name] = value;
    save(doc);
    return lastRaw || '';
  }
  const file = profileFile();
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    raw = lastRaw || '';
  }
  const empty =
    value == null ||
    (Array.isArray(value) && !value.length) ||
    (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);
  let next;
  if (!String(raw || '').trim()) {
    next = empty ? '' : dumpDoc({ [name]: value });
  } else {
    const lines = raw.split('\n');
    const start = lines.findIndex((line) => new RegExp(`^${escapeRe(name)}:`).test(line));
    if (empty) {
      if (start < 0) next = raw;
      else {
        lines.splice(start, topLevelBlockEnd(lines, start) - start);
        next = lines.join('\n').replace(/\n{3,}/g, '\n\n');
      }
    } else {
      const block = yaml.dump({ [name]: value }, { lineWidth: 100, noRefs: true, sortingKeys: false }).trimEnd();
      if (start < 0) next = raw.replace(/\s*$/, '\n\n' + block + '\n');
      else {
        const end = topLevelBlockEnd(lines, start);
        next = [...lines.slice(0, start), ...block.split('\n'), ...lines.slice(end)].join('\n');
      }
    }
    const lost = topLevelKeys(raw).filter((k) => k !== name && !topLevelKeys(next).includes(k));
    if (lost.length) {
      let prev = {};
      try {
        prev = yaml.load(raw) || {};
      } catch (_) {
        next = raw;
        prev = null;
      }
      if (prev) {
        const merged = { ...prev };
        if (empty) delete merged[name];
        else merged[name] = value;
        next = dumpDoc(merged);
      }
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (next && !next.endsWith('\n')) next += '\n';
  fs.writeFileSync(file, next);
  lastRaw = next;
  invalidateDerived();
  return next;
}

function replaceDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('Profile must be a mapping');
  }
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    const next = persist.nodeStore().setProfile(doc);
    lastRaw = yaml.dump(next);
    loadedDoc = next;
    invalidateDerived();
    return clone(next);
  }
  const prev = clone(load());
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(doc)])];
  for (const key of keys) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(doc[key])) setTopLevel(key, doc[key]);
  }
  return clone(load());
}

function writeRaw(text) {
  const raw = String(text ?? '');
  let doc;
  try {
    doc = yaml.load(raw);
  } catch (err) {
    throw new Error(`Profile YAML: ${(err && err.message) || err}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('Profile YAML must be a mapping');
  }
  if (require('./store/mode').isSupabase()) return replaceDocument(doc);
  const file = profileFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = raw.endsWith('\n') ? raw : `${raw}\n`;
  fs.writeFileSync(file, next);
  lastRaw = next;
  loadedDoc = doc;
  invalidateDerived();
  return clone(doc);
}

function save(doc, changed) {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    const next = persist.nodeStore().setProfile(doc);
    lastRaw = yaml.dump(next);
    invalidateDerived();
    return lastRaw;
  }
  const file = profileFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let next = lastRaw;
  if (next) {
    try {
      for (const row of changed || []) next = patchYaml(next, row.path, row.value);
    } catch (_) {
      next = null;
    }
  }
  if (next == null || next === '') next = dumpDoc(doc);
  fs.writeFileSync(file, next);
  lastRaw = next;
  invalidateDerived();
  return next;
}

function applyUpdates(updates) {
  const rows = normalizeUpdates(updates);
  if (!rows.length) return [];
  const doc = clone(load());
  const applied = [];
  for (const row of rows) {
    const previous = getDeep(doc, row.parts);
    if (previous === row.value) {
      applied.push({ path: row.path, value: row.value, previous, changed: false });
      continue;
    }
    setDeep(doc, row.parts, row.value);
    applied.push({ path: row.path, value: row.value, previous, changed: true });
  }
  const dirty = applied.filter((row) => row.changed);
  if (dirty.length) save(doc, dirty);
  return applied;
}

function parseAgeFromText(text) {
  const s = String(text || '');
  const m =
    s.match(/\b(?:i(?:['’]m| am)|age(?:\s+is)?)\b[^.?\n]{0,48}\b(\d{2})\s*(?:years?\s*old)?/i) ||
    s.match(/\b(\d{2})\s+years?\s*old\b/i);
  if (!m) return null;
  return asInt(m[1], 18, 80);
}

function slugSkill(name) {
  let slug = String(name || '')
    .toLowerCase()
    .replace(/\.js$/i, 'js')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
  if (slug.length > 2 && slug.endsWith('js') && !slug.endsWith('script')) slug = slug.slice(0, -2);
  return slug;
}

function looksLikeSkillToken(label) {
  const t = String(label || '').trim();
  if (!t || SKIP_SKILL_TOKENS.has(slugSkill(t))) return false;
  try {
    if (require('./profile-skills').matchSkill(t)) return true;
  } catch (_) {}
  if (/js$|\.js|kit$|script$/i.test(t)) return true;
  if (/^[A-Za-z][A-Za-z0-9.+#]{1,24}$/.test(t)) return true;
  return false;
}

function resolveSkillId(label) {
  try {
    const hit = require('./profile-skills').matchSkill(label);
    if (hit) return hit.id;
  } catch (_) {}
  if (!looksLikeSkillToken(label)) return null;
  const id = slugSkill(label);
  return id && !SKIP_SKILL_TOKENS.has(id) ? id : null;
}

function parseSkillYearsFromText(text) {
  const s = String(text || '');
  const out = [];
  const seen = new Set();
  const add = (label, years) => {
    const id = resolveSkillId(label);
    const n = asInt(years, 0, 40);
    if (!id || n == null || seen.has(id)) return;
    seen.add(id);
    out.push({ path: `skills.${id}`, value: n });
  };
  for (const m of s.matchAll(/\b(\d{1,2})\s+years?\s+(?:of|with|in|using|writing|on)\s+([A-Za-z][A-Za-z0-9.+# /-]{1,40})/gi)) {
    add(m[2], Number(m[1]));
  }
  for (const m of s.matchAll(/\b([A-Za-z][A-Za-z0-9.+#]{1,24})(?:\.js)?\s+(?:is|at|=|:)\s+(\d{1,2})(?:\s+years?)?\b/gi)) {
    add(m[1], Number(m[2]));
  }
  for (const m of s.matchAll(
    /\bno(?:\s+\w+){0,4}\s+(?:exp(?:erience)?|experience)\s+(?:w(?:ith)?|in|using)?\s+([A-Za-z][A-Za-z0-9.+#]{1,24})/gi
  )) {
    add(m[1], 0);
  }
  return out;
}

function inferFromText(text) {
  const out = [];
  const age = parseAgeFromText(text);
  if (age) out.push({ path: 'identity.age', value: age });
  out.push(...parseSkillYearsFromText(text));
  return out;
}

function looksLikeStory(update) {
  const text = String((update && update.text) || '').trim();
  if (!text) return false;
  const inferred = inferFromText(text);
  const storyVerb = /\b(shipped|built|owned|wrote|launched|led|migrated|designed)\b/i.test(text) || /\bat\s+[A-Za-z]/.test(text);
  if (inferred.length && text.length < 80 && !storyVerb) return false;
  if (String((update && update.employer) || '').trim() && (text.length >= 20 || storyVerb)) return true;
  return text.length > 80 || storyVerb;
}

function splitExperienceUpdates(updates) {
  const cards = [];
  const profile = [];
  for (const update of Array.isArray(updates) ? updates : []) {
    if (!update || typeof update !== 'object') continue;
    if ((update.path || update.key) && update.value != null && !update.text) {
      profile.push({ path: update.path || update.key, value: update.value });
      continue;
    }
    const inferred = inferFromText(update.text || '');
    profile.push(...inferred);
    if (looksLikeStory(update) || (String(update.text || '').trim() && !inferred.length)) {
      cards.push(update);
    }
  }
  return { cards, profile };
}

function harvestFromText(text) {
  return applyUpdates(inferFromText(text));
}

/** Later list wins on the same path. Use LLM updates as `preferred`. */
function mergeUpdates(preferred, fallback) {
  const by = new Map();
  for (const row of fallback || []) {
    if (row && row.path) by.set(String(row.path), row);
  }
  for (const row of preferred || []) {
    if (row && row.path) by.set(String(row.path), row);
  }
  return [...by.values()];
}

function skillYearsMap(profile) {
  const stacks = (profile && profile.skills) || {};
  const out = {};
  for (const [id, row] of Object.entries(stacks)) {
    if (id === 'as_of' || id === 'notes') continue;
    if (row && typeof row === 'object' && row.years != null) out[id] = Number(row.years);
  }
  return out;
}

function stacksFromProfile(profile) {
  const raw = (profile && profile.skills) || {};
  const out = {};
  for (const [id, row] of Object.entries(raw)) {
    if (id === 'as_of' || id === 'notes') continue;
    if (row && typeof row === 'object' && ('years' in row || 'aliases' in row || 'since' in row)) {
      out[id] = row;
    }
  }
  return out;
}

function profileFacts(profile) {
  const src = profile || {};
  const id = src.identity || {};
  const work = src.work || {};
  const pay = work.compensation || {};
  const ed = (src.education && src.education[0]) || {};
  return {
    legal_name: id.legal_name,
    preferred_name: id.preferred_name,
    first_name: id.first_name,
    last_name: id.last_name,
    email: id.email,
    phone: id.phone,
    linkedin: id.linkedin,
    github: id.github,
    portfolio: id.portfolio,
    mailing_city: id.city,
    mailing_state: id.state,
    mailing_zip: id.zip,
    based_city: id.based_city,
    based_state: id.based_state,
    based_state_code: id.based_state_code,
    remote: work.remote,
    authorized_us: work.legally_authorized_to_work_us,
    sponsorship: work.requires_sponsorship_now_or_future,
    target_usd: pay.target_usd,
    history_usd: pay.history_usd,
    school: ed.school,
    degree: ed.degree,
    gpa: ed.gpa,
    gpa_scale: ed.gpa_scale,
    honors: ed.honors,
    age: id.age || null,
    skills: skillYearsMap(src),
    geo: 'Mailing address and where they work are separate. Use based city for work location.',
  };
}

module.exports = {
  SCALAR,
  profileFile,
  load,
  rawYaml,
  save,
  replaceDocument,
  writeRaw,
  invalidate,
  applyUpdates,
  writeTrusted,
  setTopLevel,
  normalizeUpdates,
  parseAgeFromText,
  parseSkillYearsFromText,
  inferFromText,
  splitExperienceUpdates,
  harvestFromText,
  mergeUpdates,
  profileFacts,
  skillYearsMap,
  stacksFromProfile,
  patchYaml,
};
