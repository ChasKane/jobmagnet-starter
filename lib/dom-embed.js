/** MarkupLM-style node vectors: text + XPath, no 2D boxes. */

const DIM = 64;
const MAX_DEPTH = 8;
const EXACT = 0.93;
const NEAR = 0.74;

const TAGS = [
  'html', 'body', 'form', 'fieldset', 'legend', 'label', 'div', 'span', 'section',
  'main', 'article', 'ul', 'ol', 'li', 'p', 'h1', 'h2', 'h3', 'button', 'input',
  'select', 'option', 'textarea', 'a', 'table', 'tr', 'td', 'th', 'nav',
];

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vecFromSeed(seed) {
  const rnd = mulberry(seed || 1);
  const v = new Float64Array(DIM);
  for (let i = 0; i < DIM; i += 1) v[i] = rnd() * 2 - 1;
  return v;
}

function hash32(s) {
  let h = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TAG_VECS = Object.fromEntries(TAGS.map((t, i) => [t, vecFromSeed(101 + i * 17)]));
const FAMILY_VECS = {
  text: vecFromSeed(401),
  react_select: vecFromSeed(402),
  combobox: vecFromSeed(403),
  native_select: vecFromSeed(404),
  choice_group: vecFromSeed(405),
};

function add(dst, src, scale) {
  const w = scale == null ? 1 : scale;
  for (let i = 0; i < DIM; i += 1) dst[i] += (src[i] || 0) * w;
}

function l2normalize(v) {
  let n = 0;
  for (let i = 0; i < v.length; i += 1) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (!n) return v;
  for (let i = 0; i < v.length; i += 1) v[i] /= n;
  return v;
}

function parseXPath(path) {
  return String(path || '')
    .split('>')
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .slice(-MAX_DEPTH)
    .map((part, i) => {
      const role = ((part.match(/\[role=([^\]]+)\]/) || [])[1] || '').toLowerCase();
      const cls = [...part.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1].toLowerCase()).slice(0, 2);
      const tag = part
        .replace(/\[role=[^\]]+\]/g, '')
        .replace(/:nth-[a-z-]+\(\d+\)/g, '')
        .split('.')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') || 'div';
      return { tag, role, cls, sub: i + 1 };
    });
}

function addHashed(dst, token, scale) {
  const h = hash32(token);
  add(dst, vecFromSeed(h), scale);
}

function addText(dst, text, scale) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!raw) return;
  const padded = ` ${raw} `;
  for (let i = 0; i < padded.length - 2; i += 1) {
    addHashed(dst, padded.slice(i, i + 3), scale);
  }
  for (const word of raw.split(' ').filter(Boolean)) addHashed(dst, `w:${word}`, scale * 1.4);
}

function embedXPath(path) {
  const v = new Float64Array(DIM);
  const parts = parseXPath(path);
  parts.forEach((part, d) => {
    const depth = 1 - d / Math.max(parts.length, 1);
    const tagVec = TAG_VECS[part.tag] || vecFromSeed(hash32(`tag:${part.tag}`));
    add(v, tagVec, 0.8 * depth);
    if (part.role) addHashed(v, `role:${part.role}`, 0.7 * depth);
    for (const c of part.cls) {
      if (c && !/^m[a-z0-9]{4,}$/.test(c) && !/magnet/.test(c)) addHashed(v, `cls:${c}`, 0.35 * depth);
    }
    addHashed(v, `sub:${Math.min(part.sub, 16)}`, 0.15 * depth);
  });
  return v;
}

function familyOf(field) {
  if (field && field.shape && field.shape.family) return field.shape.family;
  if (!field) return 'text';
  if (field.reactSelect) return 'react_select';
  if (field.select || field.tag === 'select') return 'native_select';
  if (field.type === 'combobox' || field.type === 'listbox') return 'combobox';
  if (field.type === 'checkbox' || field.type === 'radio') return 'choice_group';
  return 'text';
}

function nodeCard(field) {
  const shape = (field && field.shape) || {};
  const family = shape.family || familyOf(field) || 'text';
  const label = String((field && (field.label || field.label_key || field.heading)) || '').trim();
  const includes = Array.isArray(field && field.label_includes) ? field.label_includes.join(' ') : '';
  const options = (field && field.options) || String((shape && shape.optionHash) || '').split('|').filter(Boolean);
  return {
    family,
    path: (shape && shape.path) || '',
    open: (shape && shape.open) || 'visible',
    bits: (shape && shape.bits) || [],
    attrs: (shape && shape.attrs) || [],
    label: label || includes,
    options,
  };
}

function embedNode(field) {
  const card = nodeCard(field);
  const v = new Float64Array(DIM);
  add(v, FAMILY_VECS[card.family] || vecFromSeed(hash32(`fam:${card.family}`)), 1.35);
  add(v, embedXPath(card.path), 0.65);
  addText(v, card.label, 0.045);
  addText(v, (card.options || []).slice(0, 24).join(' '), 0.055);
  addText(v, (card.attrs || []).join(' '), 0.04);
  for (const bit of card.bits || []) addHashed(v, `bit:${bit}`, 0.35);
  addHashed(v, `open:${card.open}`, 0.25);
  return { vec: l2normalize(v), card, family: card.family };
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

function rankFromSim(sim) {
  if (sim >= EXACT) return 'exact';
  if (sim >= NEAR) return 'near';
  return 'far';
}

function embedDistance(a, b) {
  const ea = embedNode(a);
  const eb = embedNode(b);
  if (ea.family !== eb.family) return { rank: 'far', score: 0, method: 'embed' };
  const score = cosine(ea.vec, eb.vec);
  return { rank: rankFromSim(score), score, method: 'embed' };
}

module.exports = {
  DIM,
  EXACT,
  NEAR,
  parseXPath,
  embedNode,
  embedDistance,
  cosine,
  rankFromSim,
  nodeCard,
};
