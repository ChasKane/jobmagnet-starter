const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { normalizeQuestion } = require('./normalize');
const { shapeDistance, shapeFromField, bitsForFamily, distinctiveShape } = require('./cluster');

const RECIPES_FILE = path.join(__dirname, '..', 'knowledge', 'field-recipes.yaml');

function recipesFile() {
  return process.env.MAGNET_RECIPES || RECIPES_FILE;
}

function hashSource(source) {
  return crypto.createHash('sha256').update(String(source || ''), 'utf8').digest('hex').slice(0, 16);
}

let extraRecipes = [];

function setRecipeSource(list) {
  extraRecipes = Array.isArray(list) ? list.slice() : [];
  return extraRecipes;
}

function loadRecipes() {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    let recipes = persist.nodeStore().listRecipes();
    if (extraRecipes.length) recipes = recipes.concat(extraRecipes);
    return { version: 2, recipes };
  }
  let doc = { version: 2, recipes: [] };
  try {
    const file = recipesFile();
    if (fs.existsSync(file)) {
      doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
      if (!Array.isArray(doc.recipes)) doc.recipes = [];
      doc = migrateDoc(doc);
    }
  } catch (err) {
    console.warn('[magnet] recipes load:', err.message || err);
  }
  if (extraRecipes.length) doc.recipes = doc.recipes.concat(extraRecipes);
  doc.recipes = doc.recipes.map((r) => {
    if (!r || !Array.isArray(r.steps) || looksLikeDateFill(r)) return r;
    const steps = dropDateMaskPoke(r.steps, false);
    if (steps.length === r.steps.length) return r;
    return { ...r, steps };
  });
  return doc;
}

function inferShapeFromRecipe(recipe) {
  if (recipe && recipe.shape && recipe.shape.family) return recipe.shape;
  const blob = JSON.stringify((recipe && recipe.steps) || []) + ' ' + String((recipe && recipe.selector) || '');
  let family = 'text';
  if (/select__control|react-select|clickOption|"react_select"/.test(blob)) family = 'react_select';
  else if (/\bcombobox\b/.test(blob)) family = 'combobox';
  else if (/<select|select_value|tag":"select/.test(blob)) family = 'native_select';
  else if (/radio|checkbox|click-label/.test(blob)) family = 'choice_group';
  const open = family === 'react_select' || family === 'combobox' ? 'click-typeahead' : 'visible';
  return {
    family,
    open,
    optionCount: 0,
    optionHash: recipe && recipe.optionHash ? String(recipe.optionHash) : '',
    bits: (recipe && recipe.bits) || bitsForFamily(family, open),
    path: (recipe && recipe.path) || '',
  };
}

const NOTICE_STRATEGIES = ['input_events', 'date_mask', 'label_click', 'react_select', 'combobox'];

function isNoticeStrategy(name) {
  return NOTICE_STRATEGIES.includes(String(name || '').trim());
}

function pokeName(step) {
  if (!step || typeof step !== 'object') return '';
  if (step.op === 'poke') return String(step.strategy || '').trim();
  if (isNoticeStrategy(step.op) && !step.strategy) return String(step.op).trim();
  return '';
}

const DATE_LABEL_RE =
  /\b(date of birth|birth ?date|birth ?year|start date|end date|start month|end month|graduation date|available (start|from)|earliest start)\b/;
const NOT_DATE_LABEL_RE = /\b(how many years|years of (experience|exp)|years experience|start typing)\b/;

function looksLikeDateValue(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return false;
  return /^\d{4}-\d{2}(-\d{2})?$/.test(s) || /^\d{1,2}\/\d{4}$/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s);
}

function looksLikeDateLabel(label) {
  const key = normalizeQuestion(label);
  if (!key || NOT_DATE_LABEL_RE.test(key)) return false;
  if (DATE_LABEL_RE.test(key) || /^(from|to|until|start|end|date|month|year)$/.test(key)) return true;
  return /\b(month|year)\b/.test(key) && /\b(start|end|from|to|until|graduat)\b/.test(key);
}

function looksLikeDateFill(field, extra = {}) {
  if (extra && extra.dates) return true;
  const type = String((field && field.type) || '').toLowerCase();
  if (type === 'date' || type === 'month' || type === 'week' || type === 'datetime-local') return true;
  const includes = field && field.label_includes;
  const includeText = Array.isArray(includes) ? includes.join(' ') : includes || '';
  const label =
    (extra && extra.label) ||
    (field && (field.label || field.heading || field.label_key)) ||
    '';
  if (looksLikeDateLabel(label) || looksLikeDateLabel(includeText)) return true;
  const value =
    extra && extra.value != null
      ? extra.value
      : extra && extra.intended != null
        ? extra.intended
        : field && field.intended;
  return looksLikeDateValue(value);
}

function recipeDanceReady(recipe, explicitSteps, field) {
  if (Array.isArray(explicitSteps) && explicitSteps.length) return true;
  if (!recipe || recipe.match !== 'exact') return false;
  if (positionalChoiceSteps(recipe.steps, field)) return false;
  const rs = inferShapeFromRecipe(recipe);
  const fs = field && field.shape && field.shape.family ? field.shape : field ? shapeFromField(field) : null;
  if (!rs || !fs) return false;
  if (rs.optionHash && fs.optionHash && String(rs.optionHash) === String(fs.optionHash)) return true;
  if (rs.path && fs.path && String(rs.path) === String(fs.path)) return true;
  return false;
}

function positionalChoiceSteps(steps, field) {
  const t = String((field && field.type) || '').toLowerCase();
  const family = String((field && field.shape && field.shape.family) || '');
  if (!(t === 'radio' || t === 'checkbox' || family === 'choice_group')) return false;
  const list = Array.isArray(steps) ? steps : [];
  if (list.some((s) => s && s.op === 'clickOption')) return false;
  return list.some((s) => s && s.op === 'click' && /labeled-(radio|checkbox)-\d+/i.test(String(s.selector || '')));
}

function dropDateMaskPoke(steps, keep) {
  const list = Array.isArray(steps) ? steps : [];
  if (keep) return list.slice();
  return list.filter((s) => pokeName(s) !== 'date_mask');
}

function splitRecipeSteps(steps) {
  const list = Array.isArray(steps) ? steps.filter((s) => s && typeof s === 'object') : [];
  const dance = [];
  let poke = '';
  for (const step of list) {
    const name = pokeName(step);
    if (name && isNoticeStrategy(name)) {
      poke = name;
      continue;
    }
    dance.push(step);
  }
  return { dance, poke };
}

function foldPokeIntoSteps(steps, strategy) {
  const name = String(strategy || '').trim();
  const { dance, poke } = splitRecipeSteps(steps);
  if (!isNoticeStrategy(name) && !poke) return dance.slice();
  const kept = isNoticeStrategy(name) ? name : poke;
  if (!kept) return dance.slice();
  return [...dance, { op: 'poke', strategy: kept }];
}

function stripStepAnswers(step) {
  if (!step || typeof step !== 'object') return step;
  const next = { ...step };
  if (next.op === 'type' || next.op === 'clickOption') {
    delete next.text;
    delete next.value;
    if (next.op === 'clickOption') delete next.match;
  }
  return next;
}

function migrateDoc(doc) {
  const hasAnswers = (doc.recipes || []).some((r) => {
    if (!r || typeof r !== 'object') return false;
    if (r.value != null || r.profile_key) return true;
    return (r.steps || []).some((s) => s && (s.text != null || (s.op === 'clickOption' && s.match)));
  });
  if ((doc.version || 1) >= 2 && !hasAnswers) {
    return doc;
  }
  const next = { version: 2, recipes: (doc.recipes || []).map((r) => {
    if (!r || typeof r !== 'object') return r;
    const row = { ...r };
    delete row.value;
    delete row.profile_key;
    if (!row.shape) row.shape = inferShapeFromRecipe(row);
    if (Array.isArray(row.steps)) row.steps = row.steps.map(stripStepAnswers);
    return row;
  }) };
  try {
    saveRecipes(next);
  } catch (_) {}
  return next;
}

function saveRecipes(doc) {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    persist.nodeStore().replaceRecipes((doc && doc.recipes) || []);
    return;
  }
  fs.writeFileSync(
    recipesFile(),
    yaml.dump(
      { version: doc.version || 1, recipes: doc.recipes || [] },
      { lineWidth: 100, noRefs: true, sortingKeys: false }
    ),
    'utf8'
  );
}

function resolveProfilePath(profile, dotted) {
  if (!dotted) return undefined;
  return String(dotted)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), profile);
}

function includesKey(recipe) {
  if (!recipe.label_includes) return '';
  const parts = Array.isArray(recipe.label_includes) ? recipe.label_includes : [recipe.label_includes];
  return parts.map((p) => normalizeQuestion(p)).filter(Boolean).sort().join('|');
}

function shapeIdentity(shape) {
  if (!shape || !shape.family) return '';
  const bits = (shape.bits || []).slice().sort().join(',');
  return [shape.family, bits, shape.optionHash || '', String(shape.path || '')].join('::');
}

function recipeIdentity(recipe) {
  const shape = (recipe && recipe.shape) || recipe;
  if (distinctiveShape(shape)) return 'shape:' + shapeIdentity(shape);
  return 'label:' + [recipe.label_key || '', includesKey(recipe)].join('::');
}

function labelKeyMatch(recipeKey, labelKey) {
  const a = normalizeQuestion(recipeKey);
  const b = labelKey;
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 24 && b.length >= 24 && (b.startsWith(a) || a.startsWith(b))) return true;
  return false;
}

function recipeMatches(recipe, { label } = {}) {
  const labelKey = normalizeQuestion(label || '');
  if (recipe.label_key && !labelKeyMatch(recipe.label_key, labelKey)) return false;
  if (recipe.label_includes) {
    const parts = Array.isArray(recipe.label_includes)
      ? recipe.label_includes
      : [recipe.label_includes];
    if (!parts.every((p) => labelKey.includes(normalizeQuestion(p)))) return false;
  }
  return Boolean(recipe.label_key || recipe.label_includes);
}

function recipeScore(recipe, ctx) {
  if (!recipeMatches(recipe, ctx)) return -1;
  let s = 0;
  if (recipe.label_key) s += 10;
  if (recipe.label_includes) s += 5;
  return s;
}

function familyOfField(field) {
  if (!field) return '';
  const shape = field.shape && field.shape.family ? field.shape : shapeFromField(field);
  return (shape && shape.family) || '';
}

function recipeFitsField(recipe, field) {
  if (!recipe || !field) return true;
  if (recipe.route === 'skip' || recipe.route === 'needs_llm') return true;
  const want = familyOfField(field);
  if (!want) return true;
  const got = inferShapeFromRecipe(recipe).family;
  if (!got) return true;
  return got === want;
}

function rankWeight(rank) {
  if (rank === 'exact') return 2;
  if (rank === 'near') return 1;
  return 0;
}

function findShapeRecipe(field) {
  const shape = field && (field.shape && field.shape.family ? field.shape : shapeFromField(field));
  if (!shape || !shape.family) return null;
  let best = null;
  let bestScore = -1;
  let bestRank = 'far';
  for (const recipe of loadRecipes().recipes) {
    if (recipe.route === 'skip' && !(recipe.shape && recipe.shape.family)) continue;
    const rs = inferShapeFromRecipe(recipe);
    if (!rs.family || rs.family !== shape.family) continue;
    const d = shapeDistance(
      { ...field, shape, label: field.label || field.heading, options: field.options },
      {
        shape: rs,
        label: recipe.label_key || (Array.isArray(recipe.label_includes) ? recipe.label_includes.join(' ') : ''),
        options: String(rs.optionHash || '').split('|').filter(Boolean),
      }
    );
    const rank = d.rank;
    if (rank === 'far') continue;
    const score = (d.score || 0) + (recipe.steps && recipe.steps.length ? 0.05 : 0);
    if (rankWeight(rank) > rankWeight(bestRank) || (rank === bestRank && score > bestScore)) {
      best = recipe;
      bestScore = score;
      bestRank = rank;
    }
  }
  if (!best) return null;
  return { ...best, shape: inferShapeFromRecipe(best), match: bestRank, embedScore: bestScore };
}

function findRecipe({ label, field } = {}) {
  const shaped = field ? findShapeRecipe(field) : null;
  if (shaped && (shaped.match === 'exact' || shaped.match === 'near')) return shaped;
  let best = null;
  let bestScore = -1;
  for (const recipe of loadRecipes().recipes) {
    if (field && !recipeFitsField(recipe, field)) continue;
    const s = recipeScore(recipe, { label });
    if (s > bestScore) {
      best = recipe;
      bestScore = s;
    }
  }
  if (!best) return shaped || null;
  const { value: _v, profile_key: _p, ...rest } = best;
  return { ...rest, match: 'label' };
}

function walkProfile(obj, prefix, out) {
  if (obj == null) return;
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    out.push([prefix, obj]);
    return;
  }
  if (Array.isArray(obj)) {
    if (obj.length && (typeof obj[0] === 'string' || typeof obj[0] === 'number')) {
      out.push([prefix, obj[0]]);
    }
    if (obj[0] && typeof obj[0] === 'object') walkProfile(obj[0], prefix + '[0]', out);
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      walkProfile(v, prefix ? prefix + '.' + k : k, out);
    }
  }
}

function matchingProfileKey(profile, value) {
  const want = normalizeQuestion(value);
  if (!want || /^(yes|no|true|false|n a|na)$/.test(want)) return undefined;
  if (/^\d+(\.\d+)?$/.test(want) || want.length <= 2) return undefined;
  const rows = [];
  walkProfile(profile, '', rows);
  for (const [key, val] of rows) {
    if (val == null || val === '') continue;
    if (normalizeQuestion(val) === want) return key.replace(/\[0\]/g, '');
  }
  return undefined;
}

function isEphemeralSelector(sel) {
  return /data-field-id=["']m[a-z0-9]+["']|#m[a-z0-9]{4,}|data-magnet-field/.test(String(sel || ''));
}

function scrubSteps(steps, ctx = {}) {
  return (steps || [])
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const step = { ...s };
      if (step.selector) {
        const kept = String(step.selector)
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p && !isEphemeralSelector(p));
        if (kept.length) step.selector = kept[0];
        else if (step.op === 'click') step.selector = '.select__control';
        else delete step.selector;
      }
      if (step.op === 'type' || step.op === 'clickOption') {
        delete step.text;
        delete step.value;
        delete step.match;
      }
      if (step.op === 'click' && /labeled-(radio|checkbox)-\d+/i.test(String(step.selector || ''))) {
        return { op: 'clickOption' };
      }
      if (step.op === 'poke') {
        const name = String(step.strategy || '').trim();
        if (!isNoticeStrategy(name)) return null;
        if (name === 'date_mask' && !looksLikeDateFill(ctx.recipe || ctx.field || {}, { value: ctx.value, label: ctx.label })) {
          return null;
        }
        return { op: 'poke', strategy: name };
      }
      return step;
    })
    .filter(Boolean);
}

function isPlaceholderValue(v) {
  return /^(select|select one|choose|choose one|pick one|please select|n\/a|\.\.\.)(\.\.\.)?$/i.test(
    String(v || '').trim()
  );
}

function learnRecipe(input) {
  const label_key = input.label ? normalizeQuestion(input.label) : undefined;
  const label_includes = input.label_includes || undefined;
  const shape = input.shape && input.shape.family ? input.shape : input.family
    ? {
        family: input.family,
        bits: input.bits || bitsForFamily(input.family, input.open || 'visible'),
        optionHash: input.optionHash || '',
        path: input.path || '',
        open: input.open || 'visible',
      }
    : null;
  if (!label_key && !label_includes && !shapeIdentity(shape)) {
    throw new Error('learn requires a label or shape');
  }
  const doc = loadRecipes();
  const row = {
    learned_at: new Date().toISOString(),
  };
  if (label_key) row.label_key = label_key;
  if (label_includes) row.label_includes = label_includes;
  if (shape) {
    row.shape = {
      family: shape.family,
      open: shape.open || 'visible',
      optionHash: shape.optionHash || '',
      bits: shape.bits || bitsForFamily(shape.family, shape.open || 'visible'),
      path: shape.path || '',
    };
  }
  if (input.selector) row.selector = input.selector;
  if (input.route) row.route = input.route;
  if (Array.isArray(input.steps) && input.steps.length) {
    row.steps = scrubSteps(input.steps, { recipe: row, field: input.field, value: input.value, label: input.label });
  }
  const id = recipeIdentity(row);
  const idx = doc.recipes.findIndex((r) => recipeIdentity(r) === id);
  if (idx >= 0) {
    const prev = doc.recipes[idx];
    const next = {
      ...prev,
      ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)),
    };
    delete next.value;
    delete next.profile_key;
    if (row.steps) next.steps = row.steps;
    if (row.shape) next.shape = row.shape;
    doc.recipes[idx] = next;
    saveRecipes(doc);
    return doc.recipes[idx];
  }
  doc.recipes.push(row);
  saveRecipes(doc);
  return row;
}

function recipeValue() {
  return null;
}

function recipeRunOk(recipe) {
  if (!recipe || !recipe.run || !recipe.run.source) return false;
  if (recipe.run.hash && recipe.run.hash !== hashSource(recipe.run.source)) return false;
  return true;
}

module.exports = {
  loadRecipes,
  saveRecipes,
  setRecipeSource,
  listRecipes: () => loadRecipes().recipes,
  findRecipe,
  learnRecipe,
  recipeValue,
  recipeRunOk,
  hashSource,
  recipesFile,
  matchingProfileKey,
  resolveProfilePath,
  recipeMatches,
  inferShapeFromRecipe,
  familyOfField,
  recipeFitsField,
  shapeIdentity,
  isEphemeralSelector,
  NOTICE_STRATEGIES,
  isNoticeStrategy,
  splitRecipeSteps,
  foldPokeIntoSteps,
  looksLikeDateFill,
  looksLikeDateLabel,
  looksLikeDateValue,
  recipeDanceReady,
};
