const DEFAULT_ID = 'grok-4.6';
const DEFAULT_PARAMS = { fast: 'true' };

const FAST_PARAM = {
  id: 'fast',
  displayName: 'Fast',
  values: [
    { value: 'false' },
    { value: 'true', displayName: 'Fast' },
  ],
};

const EFFORT_PARAM = {
  id: 'effort',
  displayName: 'Effort',
  values: [
    { value: 'low', displayName: 'Low' },
    { value: 'medium', displayName: 'Medium' },
    { value: 'high', displayName: 'High' },
  ],
};

const GROK_EFFORT_PARAM = {
  id: 'effort',
  displayName: 'Effort',
  values: [
    ...EFFORT_PARAM.values,
    { value: 'xhigh', displayName: 'Extra High' },
  ],
};

const FALLBACK_CATALOG = [
  {
    id: 'auto',
    displayName: 'Auto',
    parameters: [],
    variants: [{ displayName: 'Auto', params: [], isDefault: true }],
  },
  {
    id: 'grok-4.6',
    displayName: 'Cursor Grok 4.6',
    parameters: [FAST_PARAM, GROK_EFFORT_PARAM],
    variants: [
      {
        displayName: 'Cursor Grok 4.6 High Fast',
        isDefault: true,
        params: [
          { id: 'fast', value: 'true' },
          { id: 'effort', value: 'high' },
        ],
      },
    ],
  },
  {
    id: 'composer-2.5',
    displayName: 'Composer 2.5',
    parameters: [FAST_PARAM],
    variants: [
      {
        displayName: 'Composer 2.5',
        isDefault: true,
        params: [{ id: 'fast', value: 'true' }],
      },
    ],
  },
  {
    id: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    parameters: [],
    variants: [{ displayName: 'Claude Opus 5 Max', params: [], isDefault: true }],
  },
  {
    id: 'gpt-5.6',
    displayName: 'GPT-5.6',
    parameters: [EFFORT_PARAM],
    variants: [
      {
        displayName: 'GPT-5.6 High',
        isDefault: true,
        params: [{ id: 'effort', value: 'high' }],
      },
    ],
  },
];

let cachedCatalog = null;

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function asParamMap(value) {
  if (Array.isArray(value)) {
    const out = {};
    for (const row of value) {
      if (!row || row.id == null || row.value == null || row.value === '') continue;
      out[String(row.id)] = String(row.value);
    }
    return out;
  }
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw == null || raw === '') continue;
    out[String(key)] = String(raw);
  }
  return out;
}

function asParamList(map) {
  return Object.entries(map || {}).map(([id, value]) => ({ id, value: String(value) }));
}

function slimValues(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((row) => {
      if (row == null) return null;
      if (typeof row === 'string' || typeof row === 'number' || typeof row === 'boolean') {
        return { value: String(row), displayName: '' };
      }
      if (typeof row !== 'object' || row.value == null) return null;
      return { value: String(row.value), displayName: row.displayName ? String(row.displayName) : '' };
    })
    .filter(Boolean);
}

function slimModel(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const parameters = Array.isArray(raw.parameters)
    ? raw.parameters
        .map((param) => {
          if (!param || !param.id) return null;
          return {
            id: String(param.id),
            displayName: param.displayName ? String(param.displayName) : titleCase(param.id),
            values: slimValues(param.values),
          };
        })
        .filter(Boolean)
    : [];
  const variants = Array.isArray(raw.variants)
    ? raw.variants
        .map((variant) => {
          if (!variant || typeof variant !== 'object') return null;
          return {
            displayName: String(variant.displayName || raw.displayName || raw.id),
            description: variant.description ? String(variant.description) : '',
            isDefault: Boolean(variant.isDefault),
            params: asParamList(asParamMap(variant.params)),
          };
        })
        .filter(Boolean)
    : [];
  const window = Number(raw.contextWindow || raw.context_window);
  return {
    id: String(raw.id),
    displayName: String(raw.displayName || raw.id),
    description: raw.description ? String(raw.description) : '',
    parameters,
    variants,
    ...(Number.isFinite(window) && window > 1000 ? { contextWindow: window } : {}),
  };
}

function ensureGrokEffort(model) {
  if (!model || model.id !== 'grok-4.6') return model;
  const extra = { value: 'xhigh', displayName: 'Extra High' };
  const parameters = Array.isArray(model.parameters) ? model.parameters.slice() : [];
  const idx = parameters.findIndex((row) => row.id === 'effort');
  if (idx < 0) {
    parameters.push({ ...GROK_EFFORT_PARAM, values: GROK_EFFORT_PARAM.values.map((row) => ({ ...row })) });
    return { ...model, parameters };
  }
  const effort = parameters[idx];
  if ((effort.values || []).some((row) => row.value === 'xhigh')) return model;
  parameters[idx] = {
    ...effort,
    values: [...(effort.values || []), extra],
  };
  return { ...model, parameters };
}

function fallbackCatalog() {
  return FALLBACK_CATALOG.map(slimModel).map(ensureGrokEffort);
}

function catalog() {
  return cachedCatalog && cachedCatalog.length ? cachedCatalog : fallbackCatalog();
}

function findModel(list, id) {
  const needle = String(id || '');
  return (list || []).find((model) => model.id === needle) || null;
}

function defaultParams(model) {
  if (!model) return {};
  const variant = (model.variants || []).find((row) => row.isDefault) || (model.variants || [])[0];
  if (variant) return asParamMap(variant.params);
  const out = {};
  for (const param of model.parameters || []) {
    if (param.values && param.values[0]) out[param.id] = param.values[0].value;
  }
  return out;
}

function allowedParam(model, id, value) {
  const param = (model.parameters || []).find((row) => row.id === id);
  if (!param) return false;
  if (!param.values.length) return true;
  return param.values.some((row) => row.value === String(value));
}

function constrainParams(model, params) {
  const src = asParamMap(params);
  if (!model) return src;
  if (!(model.parameters || []).length) return {};
  const out = {};
  for (const [id, value] of Object.entries(src)) {
    if (allowedParam(model, id, value)) out[id] = value;
  }
  for (const [id, value] of Object.entries(defaultParams(model))) {
    if (out[id] == null && allowedParam(model, id, value)) out[id] = value;
  }
  return out;
}

function selectionFrom(doc, list) {
  const src = doc && typeof doc === 'object' ? doc : {};
  const id = String(src.modelId || DEFAULT_ID).trim() || DEFAULT_ID;
  const model = findModel(mergedCatalog(list || catalog(), src), id);
  const rawParams = src.modelParams == null && id === DEFAULT_ID ? DEFAULT_PARAMS : src.modelParams;
  return {
    id,
    params: constrainParams(model, rawParams),
  };
}

function customIds(doc) {
  const src = doc && doc.customModels;
  if (!Array.isArray(src)) return [];
  const out = [];
  const seen = new Set();
  for (const row of src) {
    const id = String(row || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function mergedCatalog(list, doc) {
  const out = (list && list.length ? list : fallbackCatalog()).map((model) => ({ ...model }));
  const seen = new Set(out.map((model) => model.id));
  for (const id of customIds(doc)) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, displayName: id, description: '', parameters: [], variants: [] });
  }
  const selected = String((doc && doc.modelId) || '').trim();
  if (selected && !seen.has(selected)) {
    out.push({ id: selected, displayName: selected, description: '', parameters: [], variants: [] });
  }
  return out;
}

function matchVariant(model, params) {
  const map = asParamMap(params);
  const variants = model && model.variants ? model.variants : [];
  return (
    variants.find((variant) => {
      const want = asParamMap(variant.params);
      const keys = new Set([...Object.keys(want), ...Object.keys(map)]);
      for (const key of keys) {
        if ((want[key] || '') !== (map[key] || '')) return false;
      }
      return true;
    }) || null
  );
}

function valueLabel(param, value) {
  const opt = (param.values || []).find((row) => row.value === String(value));
  if (opt && opt.displayName) return opt.displayName;
  if (String(value) === 'true') return param.displayName || titleCase(param.id);
  if (String(value) === 'false' || value == null || value === '') return '';
  return titleCase(value);
}

function isToggleParam(param) {
  const values = (param && param.values) || [];
  if (values.length !== 2) return false;
  const set = new Set(values.map((row) => String(row.value).toLowerCase()));
  return set.has('true') && set.has('false');
}

function summaryLabel(selection, model) {
  if (!model) return selection && selection.id ? selection.id : 'Model';
  const bits = [];
  const params = model.parameters || [];
  const push = (param) => {
    const value = selection.params[param.id];
    if (value == null) return;
    const label = valueLabel(param, value);
    if (label) bits.push(label);
  };
  for (const param of params) {
    if (!isToggleParam(param)) push(param);
  }
  for (const param of params) {
    if (isToggleParam(param)) push(param);
  }
  if (bits.length) return bits.join(' ');
  return model.displayName || model.id;
}

function modelListLabel(model, selection) {
  const params = model && selection && model.id === selection.id ? selection.params : defaultParams(model);
  const variant = matchVariant(model, params);
  return (variant && variant.displayName) || (model && model.displayName) || (model && model.id) || '';
}

function contextWindow(model) {
  const n = Number(model && (model.contextWindow || model.context_window));
  return Number.isFinite(n) && n > 1000 ? n : 128000;
}

function toAgentModel(selection, list) {
  const model = findModel(list || catalog(), selection && selection.id);
  const id = (selection && selection.id) || DEFAULT_ID;
  const params = constrainParams(model, (selection && selection.params) || {});
  const entries = asParamList(params);
  return entries.length ? { id, params: entries } : { id };
}

function snapshot(doc, list) {
  const catalogList = mergedCatalog(list || catalog(), doc);
  const selection = selectionFrom(doc, catalogList);
  const model = findModel(catalogList, selection.id);
  return {
    selection,
    catalog: catalogList,
    customModels: customIds(doc),
    summary: summaryLabel(selection, model),
    modelLabel: (model && model.displayName) || selection.id,
    agent: toAgentModel(selection, catalogList),
  };
}

function pickModel(doc, id, list) {
  const catalogList = mergedCatalog(list || catalog(), { ...doc, modelId: id });
  const model = findModel(catalogList, id) || { id, displayName: id, parameters: [], variants: [] };
  return {
    modelId: model.id,
    modelParams: defaultParams(model),
    customModels: customIds(doc),
  };
}

function setParam(doc, paramId, value, list) {
  const selection = selectionFrom(doc, list);
  const catalogList = mergedCatalog(list || catalog(), doc);
  const model = findModel(catalogList, selection.id);
  const next = { ...selection.params };
  if (value == null || value === '') delete next[paramId];
  else next[paramId] = String(value);
  return {
    modelId: selection.id,
    modelParams: constrainParams(model, next),
    customModels: customIds(doc),
  };
}

function addCustom(doc, rawId) {
  const id = String(rawId || '').trim();
  if (!id) return null;
  const customModels = customIds(doc);
  if (!customModels.includes(id)) customModels.push(id);
  return { modelId: id, modelParams: {}, customModels };
}

async function refreshCatalog() {
  try {
    const { Cursor } = require('@cursor/sdk');
    const rows = await Cursor.models.list({ apiKey: process.env.CURSOR_API_KEY });
    const slim = (Array.isArray(rows) ? rows : []).map(slimModel).filter(Boolean).map(ensureGrokEffort);
    if (slim.length) cachedCatalog = slim;
  } catch (_) {}
  return catalog();
}

function resetCatalog() {
  cachedCatalog = null;
}

module.exports = {
  DEFAULT_ID,
  DEFAULT_PARAMS,
  FALLBACK_CATALOG,
  GROK_EFFORT_PARAM,
  catalog,
  fallbackCatalog,
  slimModel,
  selectionFrom,
  constrainParams,
  defaultParams,
  findModel,
  matchVariant,
  summaryLabel,
  modelListLabel,
  toAgentModel,
  contextWindow,
  snapshot,
  pickModel,
  setParam,
  addCustom,
  customIds,
  mergedCatalog,
  isToggleParam,
  valueLabel,
  refreshCatalog,
  resetCatalog,
  asParamMap,
  asParamList,
};
