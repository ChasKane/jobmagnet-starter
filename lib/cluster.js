/** Cluster inventory: one question owns options + shape + controls. */

const { normalizeQuestion } = require('./normalize');
const { isInstructionLabel, isQuestionLike, isSectionChrome } = require('./question-cascade');

const GENERIC_LABEL_RE =
  /^(select|select one|choose|choose one|pick|pick one|please select|n\/a|\.{2,}|start typing.*|type to search.*|search\.{2,}|begin typing.*|attach|dropbox|google drive|or enter manually|enter manually|paste)(\.{3})?$/i;

function foldToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function optionHash(options) {
  const toks = [...new Set((options || []).map(foldToken).filter(Boolean))].sort();
  return toks.join('|');
}

function isGenericLabel(s) {
  return GENERIC_LABEL_RE.test(String(s || '').trim());
}

function usableQuestion(s) {
  const t = String(s || '').trim();
  return Boolean(
    t &&
      isQuestionLike(t) &&
      !isSectionChrome(t) &&
      !isGenericLabel(t) &&
      !isInstructionLabel(t)
  );
}

function preferredQuestion(label, cascade) {
  const lab = String(label || '').trim();
  const head = String(cascade || '').trim();
  if (usableQuestion(lab)) return lab;
  const labTitle = lab && !isGenericLabel(lab) && !isInstructionLabel(lab) && !isSectionChrome(lab);
  // Keep a real field title (Name, First Name) even when a JD heading matches an alias.
  if (labTitle) return lab;
  if (usableQuestion(head)) return head;
  if (head && !isGenericLabel(head) && !isInstructionLabel(head) && !isSectionChrome(head)) return head;
  return '';
}

function bestQuestion(...texts) {
  const raw = texts.flat().map((t) => String(t || '').trim()).filter(Boolean);
  const question = raw.find((t) => usableQuestion(t));
  if (question) return question;
  const plain = raw.find((t) => !isInstructionLabel(t) && !isGenericLabel(t) && !isSectionChrome(t));
  return plain || '';
}

function bitsForFamily(family, open) {
  if (family === 'react_select') return ['listbox-on-open', 'typeahead', 'clickOption'];
  if (family === 'combobox') return ['typeahead', 'clickOption'];
  if (family === 'native_select') return ['select_value'];
  if (family === 'choice_group') return open === 'visible' ? ['click-label'] : ['click-label', 'role-radio'];
  return ['native_value'];
}

function widgetFamily(field) {
  if (!field) return 'text';
  if (field.shape && field.shape.family) return field.shape.family;
  if (field.reactSelect) return 'react_select';
  if (field.select || field.tag === 'select') return 'native_select';
  if (field.type === 'combobox' || field.type === 'listbox') return 'combobox';
  if (field.type === 'checkbox' || field.type === 'radio') return 'choice_group';
  return 'text';
}

function widgetShapeName(field) {
  const family = widgetFamily(field);
  if (family === 'choice_group') return 'checkbox';
  return family;
}

function shapeFromField(field) {
  if (field && field.shape && field.shape.family) {
    const family = field.shape.family;
    const options = field.options || [];
    const open =
      field.shape.open ||
      ((family === 'react_select' || family === 'combobox') && !options.length ? 'click-typeahead' : 'visible');
    return {
      family,
      open,
      optionCount: field.shape.optionCount != null ? field.shape.optionCount : options.length,
      optionHash: field.shape.optionHash || optionHash(options),
      bits: Array.isArray(field.shape.bits) && field.shape.bits.length ? field.shape.bits : bitsForFamily(family, open),
      path: field.shape.path || '',
      attrs: Array.isArray(field.shape.attrs) ? field.shape.attrs : [],
    };
  }
  const family = widgetFamily(field);
  const options = (field && field.options) || [];
  const open = (family === 'react_select' || family === 'combobox') && !options.length ? 'click-typeahead' : 'visible';
  return {
    family,
    open,
    optionCount: options.length,
    optionHash: optionHash(options),
    bits: bitsForFamily(family, open),
    path: '',
    attrs: [],
  };
}

function controlStub(field) {
  return {
    id: field.id,
    tag: field.tag || '',
    type: field.type || '',
    name: field.name || '',
  };
}

function uniqStrings(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const k = foldToken(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function preferClusterField(a, b) {
  const score = (f) => {
    let n = 0;
    if (f.magnetState === 'green') n += 8;
    if ((f.options || []).length) n += 3;
    if (f.label && !isGenericLabel(f.label) && !isInstructionLabel(f.label)) n += 4;
    if (f.reactSelect || f.select) n += 2;
    if (f.value) n += 1;
    const t = String(f.type || '').toLowerCase();
    if (t === 'combobox' || t === 'listbox' || f.tag === 'select' || f.tag === 'textarea') n += 2;
    if (t !== 'radio' && t !== 'checkbox') n += 1;
    return n;
  };
  return score(a) >= score(b) ? a : b;
}

function mergeTwo(a, b) {
  const primary = preferClusterField(a, b);
  const secondary = primary === a ? b : a;
  const options = uniqStrings([...(primary.options || []), ...(secondary.options || [])]).slice(0, 48);
  const controls = [];
  const seen = new Set();
  for (const c of [...(primary.controls || [controlStub(primary)]), ...(secondary.controls || [controlStub(secondary)])]) {
    if (!c || !c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    controls.push(c);
  }
  const shape = shapeFromField({ ...primary, options });
  const label = bestQuestion(primary.label, primary.heading, secondary.label, secondary.heading);
  const longer = (a, b) => (String(a || '').length >= String(b || '').length ? a : b);
  return {
    ...primary,
    options,
    controls,
    shape,
    clusterId: primary.clusterId || secondary.clusterId || '',
    label: label || preferredQuestion(primary.label, primary.heading || secondary.label),
    heading: bestQuestion(primary.heading, secondary.heading, primary.label, secondary.label) || primary.heading || secondary.heading || '',
    hostHtml: longer(primary.hostHtml, secondary.hostHtml),
    clusterHtml: longer(primary.clusterHtml, secondary.clusterHtml),
  };
}

function questionTextKey(field) {
  const lab = normalizeQuestion(preferredQuestion((field && field.label) || '', (field && field.heading) || ''));
  if (!lab || lab.length < 16 || isGenericLabel(lab) || isInstructionLabel(lab) || isSectionChrome(lab)) return '';
  return 'q:' + lab;
}

function clusterDedupeKey(field) {
  const text = questionTextKey(field);
  if (text) return text;
  if (field && field.clusterId) return 'cid:' + field.clusterId;
  const lab = normalizeQuestion((field && field.label) || '');
  if (!lab || isGenericLabel(lab) || isInstructionLabel(lab)) return '';
  const shape = shapeFromField(field);
  return lab + '|' + shape.family + '|' + shape.optionHash;
}

function mergeInventoryClusters(fields) {
  const rows = Array.isArray(fields) ? fields : [];
  const byId = new Map();
  const extras = [];
  for (const f of rows) {
    if (!f) continue;
    const cid = f.clusterId;
    if (!cid) {
      extras.push(f);
      continue;
    }
    const prev = byId.get(cid);
    byId.set(cid, prev ? mergeTwo(prev, f) : {
      ...f,
      controls: f.controls && f.controls.length ? f.controls : [controlStub(f)],
      options: uniqStrings(f.options).slice(0, 48),
      shape: shapeFromField(f),
      label: preferredQuestion(f.label, f.heading),
    });
  }
  return [...byId.values(), ...extras];
}

function jaccard(a, b) {
  const A = new Set((a || []).filter(Boolean));
  const B = new Set((b || []).filter(Boolean));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function pathTokens(path) {
  return String(path || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && t.length > 1 && !/^(div|span|form|input|body|html|label|textarea)$/.test(t));
}

function distinctiveShape(shape) {
  if (!shape || !shape.family) return false;
  if (String(shape.optionHash || '').split('|').filter(Boolean).length) return true;
  if (pathTokens(shape.path).length) return true;
  return false;
}

function shapeDistance(a, b) {
  const sa = shapeFromField(a);
  const sb = shapeFromField(b);
  if (sa.family !== sb.family) return { rank: 'far', score: 0 };
  const distinctive = distinctiveShape(sa) && distinctiveShape(sb);
  const { embedDistance } = require('./dom-embed');
  const d = embedDistance(
    { ...a, shape: sa, options: a && a.options, label: a && (a.label || a.label_key) },
    { ...b, shape: sb, options: b && b.options, label: b && (b.label || b.label_key) }
  );
  if (!distinctive) return { rank: 'far', score: d.score, method: 'embed' };
  if (d.rank === 'exact' || d.rank === 'near') return d;
  const optA = String(sa.optionHash || '').split('|').filter(Boolean);
  const optB = String(sb.optionHash || '').split('|').filter(Boolean);
  if (optA.length && optA.join('|') === optB.join('|') && d.score >= 0.6) {
    return { rank: 'near', score: Math.max(d.score, 0.74), method: 'embed' };
  }
  return { rank: 'far', score: d.score, method: 'embed' };
}

function pageClusterSource() {
  return [
    'const GENERIC_LABEL_RE = ' + GENERIC_LABEL_RE.toString() + ';',
    'const foldToken = ' + foldToken.toString() + ';',
    'const optionHash = ' + optionHash.toString() + ';',
    'const bitsForFamily = ' + bitsForFamily.toString() + ';',
    'const isGenericLabel = ' + isGenericLabel.toString() + ';',
    'const usableQuestion = ' + usableQuestion.toString() + ';',
    'const preferredQuestion = ' + preferredQuestion.toString() + ';',
    'const bestQuestion = ' + bestQuestion.toString() + ';',
  ].join('\n    ');
}

module.exports = {
  foldToken,
  optionHash,
  isGenericLabel,
  preferredQuestion,
  bitsForFamily,
  widgetFamily,
  widgetShapeName,
  shapeFromField,
  questionTextKey,
  clusterDedupeKey,
  mergeInventoryClusters,
  shapeDistance,
  distinctiveShape,
  jaccard,
  pageClusterSource,
  GENERIC_LABEL_RE,
};
