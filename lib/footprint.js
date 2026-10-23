const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { normalizeQuestion } = require('./normalize');
const { optionSetKind, placeholderOption } = require('./option-match');

const DEFAULT_FILE = path.join(__dirname, '..', 'knowledge', 'footprints.yaml');

function optionTexts(options) {
  return (options || [])
    .map((o) => String((o && (o.text || o.label || o.value)) || o || '').trim())
    .filter((o) => o && !placeholderOption(o));
}

function footprint(question, options) {
  const prompt = normalizeQuestion(question);
  const opts = optionTexts(options).map((o) => normalizeQuestion(o)).filter(Boolean).sort();
  const optionsKey = opts.join('|');
  const kind = optionSetKind(optionTexts(options));
  const basis = kind === 'eeo' ? optionsKey : `${prompt}\n${optionsKey}`;
  const id = crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
  return { id, prompt, options: optionsKey, kind };
}

function loadFootprints(file = DEFAULT_FILE) {
  if (require('./store/mode').isSupabase() && file === DEFAULT_FILE) {
    const persist = require('../packages/persist');
    persist.open();
    return { version: 1, footprints: persist.nodeStore().listFootprints() };
  }
  try {
    if (!fs.existsSync(file)) return { version: 1, footprints: [] };
    const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    if (!Array.isArray(doc.footprints)) doc.footprints = [];
    return doc;
  } catch (err) {
    console.warn('[magnet] footprints load:', err.message || err);
    return { version: 1, footprints: [] };
  }
}

function saveFootprints(doc, file = DEFAULT_FILE) {
  if (require('./store/mode').isSupabase() && file === DEFAULT_FILE) {
    const persist = require('../packages/persist');
    persist.open();
    persist.nodeStore().saveFootprints(doc);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    yaml.dump(
      { version: doc.version || 1, footprints: doc.footprints || [] },
      { lineWidth: 100, noRefs: true, sortingKeys: false }
    ),
    'utf8'
  );
}

function lookupFootprint(question, options, file = DEFAULT_FILE) {
  const fp = footprint(question, options);
  if (!fp.options) return null;
  return loadFootprints(file).footprints.find((row) => row && row.id === fp.id) || null;
}

function answerOnOptions(answer, options) {
  const want = normalizeQuestion(answer);
  if (!want) return '';
  return (
    optionTexts(options).find((o) => {
      const have = normalizeQuestion(o);
      return have === want || (want.length >= 3 && (have.includes(want) || want.includes(have)));
    }) || ''
  );
}

function rememberFootprint(question, options, answer, source, file = DEFAULT_FILE) {
  const chosen = answerOnOptions(answer, options);
  if (!chosen) return null;
  const fp = footprint(question, options);
  if (!fp.prompt || !fp.options) return null;
  const doc = loadFootprints(file);
  const idx = doc.footprints.findIndex((row) => row && row.id === fp.id);
  const nextSource = source === 'taught' ? 'taught' : 'profile';
  if (idx >= 0) {
    const prev = doc.footprints[idx];
    const seen = (prev.seen || 1) + 1;
    if (prev.source === 'taught' && nextSource !== 'taught') {
      prev.seen = seen;
      doc.footprints[idx] = prev;
      saveFootprints(doc, file);
      return prev;
    }
    doc.footprints[idx] = {
      ...prev,
      prompt: fp.prompt || prev.prompt,
      options: fp.options,
      answer: chosen,
      source: nextSource,
      seen,
    };
    saveFootprints(doc, file);
    return doc.footprints[idx];
  }
  const row = {
    id: fp.id,
    prompt: fp.prompt,
    options: fp.options,
    answer: chosen,
    source: nextSource,
    seen: 1,
  };
  doc.footprints.push(row);
  saveFootprints(doc, file);
  return row;
}

module.exports = {
  DEFAULT_FILE,
  footprint,
  optionTexts,
  lookupFootprint,
  rememberFootprint,
  answerOnOptions,
  loadFootprints,
};
