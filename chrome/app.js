const companyEl = document.getElementById('company');
const titleEl = document.getElementById('title');
const salaryEl = document.getElementById('salary');
const yoeEl = document.getElementById('yoe');
const levelEl = document.getElementById('level');
const resumeLabel = document.getElementById('resume-label');
const resumeChip = document.getElementById('resume-chip');
const autofillEl = document.getElementById('autofill');
const autofillMenuEl = document.getElementById('autofill-menu');
const autofillStagesEl = document.getElementById('autofill-stages');
const completeEl = document.getElementById('complete');
const passEl = document.getElementById('pass');
const surfaceSwitch = document.getElementById('surface-switch');
const stepsEl = document.getElementById('steps');
const progressEl = document.getElementById('progress');
const metaWrap = document.getElementById('meta-wrap');
const metaToggle = document.getElementById('meta-toggle');
const jdAlertsEl = document.getElementById('jd-alerts');
const sessionCounts = document.getElementById('session-counts');
const fillStatusEl = document.getElementById('fill-status');
const runStatusEl = document.getElementById('run-status');
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');
const toastEl = document.getElementById('toast');
const toastMsg = document.getElementById('toast-msg');
const toastUndo = document.getElementById('toast-undo');
const toastBar = toastEl && toastEl.querySelector('.toast-bar');
const jdText = document.getElementById('jd-text');
const postingEl = document.getElementById('jd-posting-url');
const reviewRoot = document.getElementById('review-root');
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatQueue = document.getElementById('chat-queue');
const chatTargetEl = document.getElementById('chat-target');
const chatTargetLabel = document.getElementById('chat-target-label');
const chatTargetClear = document.getElementById('chat-target-clear');
const modelPicker = document.getElementById('model-picker');
const modelTrigger = document.getElementById('model-trigger');
const modelTriggerLabel = document.getElementById('model-trigger-label');
const modelPopovers = document.getElementById('model-popovers');
const modelMenu = document.getElementById('model-menu');
const modelFlyout = document.getElementById('model-flyout');
const chatSubtabs = document.getElementById('chat-subtabs');
const chatSubtabsPills = document.getElementById('chat-subtabs-pills');
const chatSubtabsMore = document.getElementById('chat-subtabs-more');
const chatMoreMenu = document.getElementById('chat-more-menu');
const chatSeeAll = document.getElementById('chat-see-all');
const chatSeeAllList = document.getElementById('chat-see-all-list');
const chatSeeAllClose = document.getElementById('chat-see-all-close');
const chatOpenBar = document.getElementById('chat-open-bar');
const chatOpenCopy = document.getElementById('chat-open-copy');
const chatOpenJob = document.getElementById('chat-open-job');
const ingestPlanEl = document.getElementById('ingest-plan');
const ingestPlanBody = document.getElementById('ingest-plan-body');
const ingestApprove = document.getElementById('ingest-approve');
const pageRailWrap = document.getElementById('page-rail-wrap');
const railNav = document.getElementById('rail-nav');
const STEPS = [
  { id: 'JD', title: 'Find job description' },
  { id: 'Apply?', title: 'Click Apply' },
  { id: 'Fill', title: 'Fill form fields' },
  { id: 'Review', title: 'Review leftovers' },
  { id: 'Essays', title: 'Match experience and draft' },
  { id: 'Done', title: 'Autofill finished' },
];
const RAIL_TABS = ['jd', 'debug', 'chat'];
const PAGE_TABS_RIGHT = ['jd', 'debug', 'chat'];
const PAGE_TABS_LEFT = ['chat', 'debug', 'jd'];
const INGEST_KEY = '__ingest__';
const CHAT_PLACEHOLDER = 'Talk to Magnet… (Enter to send, ⌘Enter for newline)';
const INGEST_PLACEHOLDER = 'Talk to Ingest… (Enter to send, ⌘Enter for newline)';

let current = null;
let lastComposeKey = null;
let findQuery = '';
let railTab = 'chat';
const openFolds = new Set();
const composeByTab = new Map();
const queueByTab = new Map();
const inFlightTabs = new Set();
const cancellingTabs = new Set();
let queueSeq = 0;
const acceptDrafts = new Map();
const reviewChatDrafts = new Map();
const reviewOpenIds = new Set();
const reviewStrategyPick = new Map();
let reviewFilter = 'need';
let acceptFocusKey = '';
let acceptCaret = 0;
let acceptSelEnd = 0;
let stagesOpen = false;
let modelSnap = null;
let modelOpen = false;
let modelFlyoutMode = '';
let modelQuery = '';
let modelAddOpen = false;
const FALLBACK_MODEL_SNAP = {
  selection: { id: 'grok-4.6', params: { fast: 'true', effort: 'high' } },
  catalog: [
    { id: 'auto', displayName: 'Auto', parameters: [], variants: [{ displayName: 'Auto', params: [], isDefault: true }] },
    {
      id: 'grok-4.6',
      displayName: 'Cursor Grok 4.6',
      parameters: [
        { id: 'fast', displayName: 'Fast', values: [{ value: 'false' }, { value: 'true', displayName: 'Fast' }] },
        {
          id: 'effort',
          displayName: 'Effort',
          values: [
            { value: 'low', displayName: 'Low' },
            { value: 'medium', displayName: 'Medium' },
            { value: 'high', displayName: 'High' },
            { value: 'xhigh', displayName: 'Extra High' },
          ],
        },
      ],
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
      parameters: [{ id: 'fast', displayName: 'Fast', values: [{ value: 'false' }, { value: 'true', displayName: 'Fast' }] }],
      variants: [{ displayName: 'Composer 2.5', isDefault: true, params: [{ id: 'fast', value: 'true' }] }],
    },
    { id: 'claude-opus-5', displayName: 'Claude Opus 5', parameters: [], variants: [{ displayName: 'Claude Opus 5 Max', params: [], isDefault: true }] },
    {
      id: 'gpt-5.6',
      displayName: 'GPT-5.6',
      parameters: [
        {
          id: 'effort',
          displayName: 'Effort',
          values: [
            { value: 'low', displayName: 'Low' },
            { value: 'medium', displayName: 'Medium' },
            { value: 'high', displayName: 'High' },
          ],
        },
      ],
      variants: [{ displayName: 'GPT-5.6 High', isDefault: true, params: [{ id: 'effort', value: 'high' }] }],
    },
  ],
  customModels: [],
  summary: 'High Fast',
  modelLabel: 'Cursor Grok 4.6',
};

const chromeShell = location.hash.replace(/^#/, '');
const isDrawerShell = chromeShell === 'drawer';
const isFooterShell = chromeShell === 'footer';
const isDockShell = chromeShell === 'dock';
const railCompose = document.querySelector('.rail-compose');
const railTabsToggle = document.getElementById('rail-tabs-toggle');
document.body.classList.add(
  isDrawerShell
    ? 'is-drawer-shell'
    : isFooterShell
      ? 'is-footer-shell'
      : isDockShell
        ? 'is-dock-shell'
        : 'is-toolbar'
);

let tabsCollapsed = false;
try {
  tabsCollapsed = sessionStorage.getItem('magnet.railTabsCollapsed') === '1';
} catch (_) {}

function applyTabsCollapsed() {
  if (railNav) railNav.classList.toggle('is-tabs-collapsed', tabsCollapsed);
  if (railCompose) railCompose.classList.toggle('is-tabs-collapsed', tabsCollapsed);
  if (!railTabsToggle) return;
  railTabsToggle.setAttribute('aria-expanded', String(!tabsCollapsed));
  railTabsToggle.title = tabsCollapsed ? 'Show tabs' : 'Hide tabs';
  railTabsToggle.textContent = tabsCollapsed ? '▴' : '▾';
}

function applyShellPane(pane) {
  document.querySelectorAll('.shell-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.pane === pane);
  });
}

if (isDrawerShell) applyTabsCollapsed();

let metaCollapsed = true;
try {
  const stored = sessionStorage.getItem('magnet.metaCollapsed');
  if (stored === '0') metaCollapsed = false;
  if (stored === '1') metaCollapsed = true;
} catch (_) {}

function applyMetaCollapsed() {
  if (metaWrap) metaWrap.classList.toggle('is-collapsed', metaCollapsed);
  if (metaToggle) {
    metaToggle.setAttribute('aria-expanded', String(!metaCollapsed));
    metaToggle.title = metaCollapsed ? 'Show job cards' : 'Hide job cards';
    metaToggle.textContent = metaCollapsed ? '▴' : '▾';
  }
  if (window.magnetChrome && window.magnetChrome.setChromeChips) {
    window.magnetChrome.setChromeChips(!metaCollapsed);
  }
}

if (metaWrap) applyMetaCollapsed();

let attentionSoundCtx = null;

function unlockAttentionSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!attentionSoundCtx) attentionSoundCtx = new AC();
  if (attentionSoundCtx.state === 'suspended') attentionSoundCtx.resume().catch(() => {});
  return attentionSoundCtx;
}

function playAttentionSound() {
  if (!isDrawerShell) return;
  const ctx = unlockAttentionSound();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [
    { f: 587.33, t: 0, d: 0.09 },
    { f: 880, t: 0.08, d: 0.16 },
  ];
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = note.f;
    gain.gain.setValueAtTime(0.0001, now + note.t);
    gain.gain.exponentialRampToValueAtTime(0.16, now + note.t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.t + note.d);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + note.t);
    osc.stop(now + note.t + note.d + 0.02);
  }
}

function conversationOf(job = current) {
  return (job && job.conversation) || null;
}

function isIngestConversation(job = current) {
  const conv = conversationOf(job);
  return Boolean(conv && conv.kind === 'ingest') || (conv && conv.key === INGEST_KEY);
}

function conversationJobId(job = current) {
  const conv = conversationOf(job);
  if (!conv || conv.kind === 'ingest') return '';
  return conv.jobId || '';
}

function actionJobId(job = current) {
  return conversationJobId(job) || (job && job.id) || '';
}

function conversationComposeKey(job = current) {
  if (isIngestConversation(job)) return INGEST_KEY;
  const conv = conversationOf(job);
  return conversationJobId(job) || (conv && conv.key) || (job && job.id) || lastComposeKey || INGEST_KEY;
}

function composeKey() {
  return conversationComposeKey();
}

function applyHandedness(hand) {
  const left = String(hand || '') === 'left';
  document.body.classList.toggle('is-left-handed', left);
  const nav = document.getElementById('rail-tabs');
  if (!nav) return;
  const order = left ? PAGE_TABS_LEFT : PAGE_TABS_RIGHT;
  const buttons = [...nav.querySelectorAll('.rail-tab')];
  buttons.sort((a, b) => order.indexOf(a.dataset.tab) - order.indexOf(b.dataset.tab));
  buttons.forEach((btn) => nav.appendChild(btn));
}

function jobFitFromWidth(width, jobCount) {
  const n = Math.max(0, Number(jobCount) || 0);
  const avail = Math.max(0, Number(width) || 0);
  const more = 40;
  const ingest = 58;
  const gap = 4;
  const pill = 64;
  let fit = Math.floor((avail - more - ingest - gap * 2) / (pill + gap));
  if (n > 0) fit = Math.max(1, fit);
  return Math.max(0, Math.min(n, fit));
}

function packConversation(payload) {
  const conv = conversationOf(payload) || {};
  const items = Array.isArray(conv.items) ? conv.items.filter((row) => row && row.kind === 'job') : [];
  const width = (chatSubtabsPills && chatSubtabsPills.clientWidth) || 280;
  const fit = jobFitFromWidth(width, items.length);
  const showN = items.length ? Math.max(0, Math.min(fit || 1, items.length)) : 0;
  const visible = items.slice(0, showN);
  const hidden = items.slice(showN);
  const overflow = hidden.slice(0, 8);
  const ingest = { key: INGEST_KEY, kind: 'ingest', label: 'Ingest' };
  const left = conv.handedness === 'left';
  return {
    active: conv.key || INGEST_KEY,
    moreSide: left ? 'right' : 'left',
    pills: left ? [ingest, ...visible] : [...visible.slice().reverse(), ingest],
    overflow,
    seeAll: hidden.length > 8,
    hidden,
  };
}

function selectConversation(key) {
  if (window.magnetChrome && window.magnetChrome.selectChat) window.magnetChrome.selectChat(key);
}

function renderConversationRail(payload) {
  if (!chatSubtabs || !chatSubtabsPills) return;
  const packed = packConversation(payload);
  chatSubtabsPills.replaceChildren();
  for (const item of packed.pills) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rail-tab' + (item.key === packed.active ? ' is-active' : '');
    btn.textContent = item.label || item.key;
    btn.title = item.company || item.title || item.label || '';
    btn.addEventListener('click', () => selectConversation(item.key));
    chatSubtabsPills.appendChild(btn);
  }
  if (chatSubtabsMore) {
    chatSubtabsMore.hidden = packed.overflow.length === 0 && !packed.seeAll;
  }
  if (chatMoreMenu) {
    chatMoreMenu.replaceChildren();
    for (const key of packed.overflow) {
      const item = ((conversationOf(payload) && conversationOf(payload).items) || []).find((row) => row.key === key) || { key, label: key };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-more-item';
      btn.textContent = item.label || key;
      btn.addEventListener('click', () => {
        chatMoreMenu.hidden = true;
        if (chatSubtabsMore) chatSubtabsMore.setAttribute('aria-expanded', 'false');
        selectConversation(key);
      });
      chatMoreMenu.appendChild(btn);
    }
    if (packed.seeAll) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-more-item';
      btn.textContent = 'See all';
      btn.addEventListener('click', () => {
        chatMoreMenu.hidden = true;
        renderSeeAll(payload);
      });
      chatMoreMenu.appendChild(btn);
    }
  }
}

function renderSeeAll(payload) {
  if (!chatSeeAll || !chatSeeAllList) return;
  const items = ((payload && payload.conversation && payload.conversation.items) || []).filter((row) => row.kind === 'job');
  chatSeeAllList.replaceChildren();
  for (const item of items) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-more-item';
    btn.textContent = [item.label, item.title].filter(Boolean).join(' · ') || item.key;
    btn.addEventListener('click', () => {
      chatSeeAll.close();
      selectConversation(item.key);
    });
    li.appendChild(btn);
    chatSeeAllList.appendChild(li);
  }
  if (typeof chatSeeAll.showModal === 'function') chatSeeAll.showModal();
}

function renderOpenBar(payload) {
  if (!chatOpenBar) return;
  const conv = conversationOf(payload);
  const show = Boolean(conv && conv.kind === 'job' && conv.canOpen);
  chatOpenBar.hidden = !show;
  if (chatOpenCopy) chatOpenCopy.textContent = conv && conv.openLabel ? `${conv.openLabel} to apply` : 'Not this page';
  if (chatOpenJob) chatOpenJob.textContent = (conv && conv.openLabel) || 'Open';
}

function ingestPlanRows(schema) {
  if (!schema) return [];
  return [
    ['Jobs', schema.n == null || schema.n === '' ? '—' : String(schema.n)],
    ['Sites', Array.isArray(schema.sites) ? schema.sites.join(', ') : '—'],
    ['Max age', schema.maxAgeDays ? `${schema.maxAgeDays} days` : 'any'],
    ['Titles', (schema.titleIncludes || []).join(', ') || '—'],
    ['Keywords', (schema.keywords || []).join(', ') || '—'],
    ['Pay', schema.salaryMin ? `${Math.round(schema.salaryMin / 1000)}k+` : '—'],
    ['Remote', schema.remote === true ? 'yes' : schema.remote === false ? 'no' : 'any'],
    ['Company', schema.company || 'any'],
    ['Exclude', (schema.excludeIndustries || []).join(', ') || '—'],
  ];
}

function renderIngestPlan(payload) {
  if (!ingestPlanEl || !ingestPlanBody) return;
  const ingest = isIngestConversation(payload);
  let plan = payload && payload.ingestPlan;
  if (!plan && ingest) {
    const msgs = (payload && payload.chat) || [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i] && msgs[i].plan) {
        plan = msgs[i].plan;
        break;
      }
    }
  }
  if (!ingest || !plan) {
    ingestPlanEl.hidden = true;
    return;
  }
  ingestPlanEl.hidden = false;
  ingestPlanBody.replaceChildren();
  for (const [label, value] of ingestPlanRows(plan)) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    ingestPlanBody.append(dt, dd);
  }
  if (ingestApprove) {
    ingestApprove.disabled = Boolean(payload && payload.ingestBusy);
    const hint = payload && payload.huntResume;
    ingestApprove.textContent =
      hint && hint.added < hint.need ? `Resume ${hint.added}/${hint.need}` : 'Go';
  }
}

function modelById(id) {
  const list = (modelSnap && modelSnap.catalog) || [];
  return list.find((row) => row.id === id) || null;
}

function isToggleParam(param) {
  const values = (param && param.values) || [];
  if (values.length !== 2) return false;
  const set = new Set(values.map((row) => String(row.value).toLowerCase()));
  return set.has('true') && set.has('false');
}

function modelToggleParam(model) {
  const params = (model && model.parameters) || [];
  return params.find((row) => row.id === 'fast' && isToggleParam(row)) || params.find(isToggleParam) || null;
}

function modelChoiceParam(model) {
  const params = (model && model.parameters) || [];
  return params.find((row) => !isToggleParam(row) && (row.id === 'effort' || /effort/i.test(row.id)))
    || params.find((row) => !isToggleParam(row))
    || null;
}

function modelValueLabel(param, value) {
  const opt = ((param && param.values) || []).find((row) => row.value === String(value));
  if (opt && opt.displayName) return opt.displayName;
  if (String(value) === 'true') return (param && param.displayName) || (param && param.id) || '';
  if (value == null || value === '' || String(value) === 'false') return '';
  return String(value);
}

function modelDefaultParams(model) {
  if (!model) return {};
  const variant = ((model.variants) || []).find((row) => row.isDefault) || ((model.variants) || [])[0];
  const out = {};
  if (variant && Array.isArray(variant.params)) {
    for (const row of variant.params) {
      if (row && row.id != null && row.value != null) out[row.id] = String(row.value);
    }
    return out;
  }
  for (const param of model.parameters || []) {
    if (param.values && param.values[0]) out[param.id] = param.values[0].value;
  }
  return out;
}

function modelListLabel(model) {
  const selected = modelSnap && modelSnap.selection && model.id === modelSnap.selection.id;
  const params = selected ? modelSnap.selection.params : modelDefaultParams(model);
  const variants = model.variants || [];
  const match = variants.find((variant) => {
    const want = {};
    for (const row of variant.params || []) {
      if (row && row.id != null) want[row.id] = String(row.value);
    }
    const keys = new Set([...Object.keys(want), ...Object.keys(params || {})]);
    for (const key of keys) {
      if ((want[key] || '') !== ((params && params[key]) || '')) return false;
    }
    return true;
  });
  return (match && match.displayName) || model.displayName || model.id;
}

function applyModelSnapshot(snap) {
  if (!snap || !snap.selection) return;
  modelSnap = snap;
  if (modelTriggerLabel) modelTriggerLabel.textContent = snap.summary || snap.modelLabel || snap.selection.id;
  if (modelTrigger) modelTrigger.title = snap.modelLabel || snap.selection.id;
  if (modelOpen) renderModelPicker();
}

function closeModelPicker() {
  modelOpen = false;
  modelFlyoutMode = '';
  modelQuery = '';
  modelAddOpen = false;
  if (modelTrigger) {
    modelTrigger.classList.remove('is-open');
    modelTrigger.setAttribute('aria-expanded', 'false');
  }
  if (modelPopovers) modelPopovers.hidden = true;
  if (modelFlyout) modelFlyout.hidden = true;
}

function saveModelPatch(patch) {
  if (window.magnetChrome && window.magnetChrome.setModel) {
    return window.magnetChrome.setModel(patch).then(applyModelSnapshot).catch(console.error);
  }
  const catalog = (modelSnap && modelSnap.catalog) || FALLBACK_MODEL_SNAP.catalog;
  const id = patch.modelId || (modelSnap && modelSnap.selection && modelSnap.selection.id) || 'grok-4.6';
  const model = catalog.find((row) => row.id === id) || { id, displayName: id, parameters: [] };
  const params = patch.modelParams || {};
  const bits = [];
  for (const param of model.parameters || []) {
    if (!isToggleParam(param)) {
      const label = modelValueLabel(param, params[param.id]);
      if (label) bits.push(label);
    }
  }
  for (const param of model.parameters || []) {
    if (isToggleParam(param)) {
      const label = modelValueLabel(param, params[param.id]);
      if (label) bits.push(label);
    }
  }
  applyModelSnapshot({
    selection: { id, params },
    catalog,
    customModels: patch.customModels || (modelSnap && modelSnap.customModels) || [],
    summary: bits.join(' ') || model.displayName || id,
    modelLabel: model.displayName || id,
  });
  return Promise.resolve();
}

function renderModelMenu() {
  if (!modelMenu || !modelSnap) return;
  const model = modelById(modelSnap.selection.id);
  const toggle = modelToggleParam(model);
  const choice = modelChoiceParam(model);
  modelMenu.replaceChildren();

  if (toggle) {
    const on = String((modelSnap.selection.params || {})[toggle.id]) === 'true';
    const row = document.createElement('div');
    row.className = 'model-row';
    const name = document.createElement('span');
    name.className = 'model-row-label';
    name.textContent = toggle.displayName || 'Fast';
    const sw = document.createElement('span');
    sw.className = 'model-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = on;
    input.setAttribute('aria-label', toggle.displayName || 'Fast');
    const knob = document.createElement('span');
    sw.append(input, knob);
    input.addEventListener('change', () => {
      const params = { ...(modelSnap.selection.params || {}) };
      params[toggle.id] = input.checked ? 'true' : 'false';
      saveModelPatch({ modelId: modelSnap.selection.id, modelParams: params });
    });
    row.addEventListener('click', (e) => {
      if (e.target === input) return;
      input.click();
    });
    row.append(name, sw);
    modelMenu.appendChild(row);
  }

  if (choice) {
    const value = (modelSnap.selection.params || {})[choice.id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'model-row' + (modelFlyoutMode === 'choice' ? ' is-active' : '');
    btn.setAttribute('role', 'menuitem');
    const name = document.createElement('span');
    name.className = 'model-row-label';
    name.textContent = choice.displayName || 'Effort';
    const val = document.createElement('span');
    val.className = 'model-row-value';
    val.textContent = modelValueLabel(choice, value) || '—';
    const chev = document.createElement('span');
    chev.className = 'model-chevron';
    chev.textContent = '›';
    val.appendChild(chev);
    btn.append(name, val);
    btn.addEventListener('click', () => {
      modelFlyoutMode = modelFlyoutMode === 'choice' ? '' : 'choice';
      modelAddOpen = false;
      renderModelPicker();
    });
    modelMenu.appendChild(btn);
  }

  const modelBtn = document.createElement('button');
  modelBtn.type = 'button';
  modelBtn.className = 'model-row' + (modelFlyoutMode === 'model' || modelFlyoutMode === 'add' ? ' is-active' : '');
  modelBtn.setAttribute('role', 'menuitem');
  const modelName = document.createElement('span');
  modelName.className = 'model-row-label';
  modelName.textContent = 'Model';
  const modelVal = document.createElement('span');
  modelVal.className = 'model-row-value';
  modelVal.textContent = modelSnap.modelLabel || modelSnap.selection.id;
  const modelChev = document.createElement('span');
  modelChev.className = 'model-chevron';
  modelChev.textContent = '›';
  modelVal.appendChild(modelChev);
  modelBtn.append(modelName, modelVal);
  modelBtn.addEventListener('click', () => {
    modelFlyoutMode = modelFlyoutMode === 'model' || modelFlyoutMode === 'add' ? '' : 'model';
    modelAddOpen = false;
    renderModelPicker();
    const search = modelFlyout && modelFlyout.querySelector('.model-search');
    if (search) search.focus();
  });
  modelMenu.appendChild(modelBtn);
}

function renderModelFlyout() {
  if (!modelFlyout || !modelSnap) return;
  const show = Boolean(modelFlyoutMode);
  modelFlyout.hidden = !show;
  if (!show) {
    modelFlyout.replaceChildren();
    return;
  }

  if (modelFlyoutMode === 'choice') {
    const model = modelById(modelSnap.selection.id);
    const choice = modelChoiceParam(model);
    modelFlyout.replaceChildren();
    const list = document.createElement('div');
    list.className = 'model-options';
    for (const opt of (choice && choice.values) || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'model-option';
      const selected = String((modelSnap.selection.params || {})[choice.id]) === String(opt.value);
      if (selected) btn.classList.add('is-selected');
      btn.textContent = opt.displayName || opt.value;
      if (selected) {
        const mark = document.createElement('span');
        mark.className = 'model-check';
        mark.textContent = '✓';
        btn.appendChild(mark);
      }
      btn.addEventListener('click', () => {
        const params = { ...(modelSnap.selection.params || {}) };
        params[choice.id] = String(opt.value);
        modelFlyoutMode = '';
        saveModelPatch({ modelId: modelSnap.selection.id, modelParams: params });
      });
      list.appendChild(btn);
    }
    modelFlyout.appendChild(list);
    return;
  }

  const q = modelQuery.trim().toLowerCase();
  const options = ((modelSnap.catalog) || []).filter((row) => {
    if (!q) return true;
    return [row.id, row.displayName, modelListLabel(row)].some((bit) => String(bit || '').toLowerCase().includes(q));
  });
  modelFlyout.replaceChildren();
  const search = document.createElement('input');
  search.className = 'model-search';
  search.type = 'search';
  search.placeholder = 'Search models';
  search.value = modelQuery;
  search.addEventListener('input', () => {
    modelQuery = search.value;
    renderModelFlyout();
    const next = modelFlyout.querySelector('.model-search');
    if (next) {
      next.focus();
      const end = next.value.length;
      next.setSelectionRange(end, end);
    }
  });
  const list = document.createElement('div');
  list.className = 'model-options';
  for (const row of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'model-option';
    const selected = row.id === modelSnap.selection.id;
    if (selected) btn.classList.add('is-selected');
    const name = document.createElement('span');
    name.textContent = modelListLabel(row);
    btn.appendChild(name);
    if (selected) {
      const mark = document.createElement('span');
      mark.className = 'model-check';
      mark.textContent = '✓';
      btn.appendChild(mark);
    }
    btn.addEventListener('click', () => {
      modelFlyoutMode = '';
      modelQuery = '';
      saveModelPatch({ modelId: row.id, modelParams: modelDefaultParams(row) });
    });
    list.appendChild(btn);
  }
  const addWrap = document.createElement('div');
  addWrap.className = 'model-add';
  if (modelAddOpen) {
    const form = document.createElement('form');
    form.className = 'model-add-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'model id';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const go = document.createElement('button');
    go.type = 'submit';
    go.textContent = 'Add';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = (input.value || '').trim();
      if (!id) return;
      const customModels = Array.from(new Set([...(modelSnap.customModels || []), id]));
      modelAddOpen = false;
      modelFlyoutMode = '';
      modelQuery = '';
      saveModelPatch({ modelId: id, modelParams: {}, customModels });
    });
    form.append(input, go);
    addWrap.appendChild(form);
    modelFlyout.append(search, list, addWrap);
    queueMicrotask(() => input.focus());
    return;
  }
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'model-option';
  addBtn.textContent = 'Add Models';
  addBtn.addEventListener('click', () => {
    modelAddOpen = true;
    renderModelFlyout();
  });
  addWrap.appendChild(addBtn);
  modelFlyout.append(search, list, addWrap);
}

function renderModelPicker() {
  if (!modelPopovers) return;
  modelPopovers.hidden = !modelOpen;
  if (modelTrigger) {
    modelTrigger.classList.toggle('is-open', modelOpen);
    modelTrigger.setAttribute('aria-expanded', String(modelOpen));
  }
  if (!modelOpen) return;
  renderModelMenu();
  renderModelFlyout();
}

function toggleModelPicker() {
  if (modelOpen) {
    closeModelPicker();
    return;
  }
  modelOpen = true;
  modelFlyoutMode = '';
  renderModelPicker();
}

function wireModelPicker() {
  if (!modelTrigger) return;
  if (!modelSnap) applyModelSnapshot(FALLBACK_MODEL_SNAP);
  modelTrigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleModelPicker();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!modelOpen || !modelPicker) return;
    if (modelPicker.contains(e.target)) return;
    closeModelPicker();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modelOpen) closeModelPicker();
  });
  if (window.magnetChrome && window.magnetChrome.getModels) {
    window.magnetChrome.getModels().then(applyModelSnapshot).catch(console.error);
  }
}

function queueItems(key) {
  return queueByTab.get(key) || [];
}

function setQueueItems(key, items) {
  if (!items.length) queueByTab.delete(key);
  else queueByTab.set(key, items);
}

function enqueueMessage(key, text, front) {
  const item = { id: 'q' + ++queueSeq, text };
  const next = queueItems(key).slice();
  if (front) next.unshift(item);
  else next.push(item);
  setQueueItems(key, next);
  renderChatQueue();
  return item;
}

function removeQueued(key, id) {
  setQueueItems(
    key,
    queueItems(key).filter((item) => item.id !== id)
  );
  renderChatQueue();
}

function takeQueued(key, id) {
  const item = queueItems(key).find((q) => q.id === id);
  if (!item) return null;
  removeQueued(key, id);
  return item;
}

function dequeueMessage(key) {
  const items = queueItems(key).slice();
  const item = items.shift();
  if (!item) return null;
  setQueueItems(key, items);
  renderChatQueue();
  return item;
}

function tabChatBusy(key) {
  if (inFlightTabs.has(key)) return true;
  if (key === INGEST_KEY) return Boolean(current && current.ingestBusy);
  const jobId = conversationJobId();
  if (jobId && jobId === key && current) return current.autofillStatus === 'running';
  return false;
}

function renderChatQueue() {
  if (!chatQueue) return;
  const show = railTab === 'chat';
  const key = composeKey();
  const items = show ? queueItems(key) : [];
  chatQueue.replaceChildren();
  if (!show || !items.length) {
    chatQueue.hidden = true;
    return;
  }
  chatQueue.hidden = false;
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'chat-queue-item';
    const head = document.createElement('div');
    head.className = 'chat-queue-head';
    const mark = document.createElement('div');
    mark.className = 'chat-queue-label';
    mark.textContent = 'Queued';
    const actions = document.createElement('div');
    actions.className = 'chat-queue-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'chat-queue-btn';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      const taken = takeQueued(key, item.id);
      if (!taken || !chatInput) return;
      chatInput.value = taken.text;
      composeByTab.set(key, taken.text);
      chatInput.focus();
      const end = chatInput.value.length;
      chatInput.setSelectionRange(end, end);
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chat-queue-btn';
    del.textContent = 'Delete';
    del.addEventListener('click', () => removeQueued(key, item.id));
    actions.append(edit, del);
    head.append(mark, actions);
    const text = document.createElement('div');
    text.className = 'chat-queue-text';
    text.textContent = item.text;
    row.append(head, text);
    chatQueue.appendChild(row);
  }
}

function tryFlushChat(key) {
  if (tabChatBusy(key)) return;
  const next = dequeueMessage(key);
  if (!next) return;
  dispatchChat(key, next.text, { fromQueue: true });
}

function tryFlushVisibleChats() {
  tryFlushChat(composeKey());
}

function refreshChatForKey(key) {
  if (composeKey() === key) renderChat(current);
}

async function dispatchChat(key, text, opts = {}) {
  inFlightTabs.add(key);
  renderChatQueue();
  refreshChatForKey(key);
  let retryLater = false;
  try {
    if (!opts.fromQueue && key !== INGEST_KEY) {
      applyRailTab('chat');
      if (window.magnetChrome.setDrawer) window.magnetChrome.setDrawer('chat');
    }
    const result =
      key === INGEST_KEY
        ? await window.magnetChrome.ingestSend(text)
        : await window.magnetChrome.chatSend(key, text);
    if (result && result.error === 'busy') retryLater = true;
  } catch (err) {
    console.error(err);
  } finally {
    inFlightTabs.delete(key);
    cancellingTabs.delete(key);
    if (retryLater) enqueueMessage(key, text, true);
    renderChatQueue();
    refreshChatForKey(key);
    if (!retryLater) tryFlushChat(key);
  }
}

async function submitChat() {
  if (!chatInput) return;
  const text = (chatInput.value || '').trim();
  if (!text) return;
  const key = composeKey();
  if (key !== INGEST_KEY && !conversationJobId() && !(conversationOf() && conversationOf().key)) return;
  chatInput.value = '';
  composeByTab.set(key, '');
  if (!tabChatBusy(key)) tryFlushChat(key);
  if (tabChatBusy(key)) {
    enqueueMessage(key, text);
    return;
  }
  await dispatchChat(key, text);
}

function applyRailTab(mode, opts = {}) {
  const next = RAIL_TABS.includes(mode) ? mode : 'chat';
  if (chatInput && railTab !== next) {
    composeByTab.set(composeKey(), chatInput.value);
  }
  railTab = next;
  const ingest = isIngestConversation();
  if (pageRailWrap) pageRailWrap.hidden = ingest;
  const page = ingest ? 'chat' : next;
  for (const id of RAIL_TABS) {
    const panel = document.getElementById('panel-' + id);
    if (panel) panel.hidden = id !== page;
  }
  document.querySelectorAll('#rail-tabs .rail-tab').forEach((btn) => {
    const on = btn.dataset.tab === next;
    btn.classList.toggle('is-active', on);
    if (on) btn.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
  if (!opts.silent && chatInput) chatInput.value = composeByTab.get(composeKey()) || chatInput.value;
  syncChatForm();
}

function text(v, fb = '—') {
  return (v || '').toString().trim() || fb;
}

function isReviewing(job) {
  if (!job) return false;
  const conv = conversationOf(job);
  if (conv && !conv.applyMatches) return Boolean(job.reviewCancellable);
  if (job.autofillStatus !== 'running') return false;
  if (job.reviewCancellable) return true;
  if (job.runKind === 'all') return false;
  return job.autofillStep === 'Review' || /reviewing leftovers/i.test(job.autofillDetail || '');
}

function isParallelReview(job) {
  return Boolean(job && job.runKind === 'all' && job.reviewCancellable);
}

function canCancelReview(job) {
  return Boolean(job && job.reviewCancellable);
}

function essayStepLabel(job) {
  const detail = (job && job.autofillDetail) || '';
  if (/revising/i.test(detail)) return 'Revising';
  if (/looking it up/i.test(detail)) return 'Research';
  if (/reviewing draft/i.test(detail)) return 'Reviewing';
  if (/drafting essays/i.test(detail)) return 'Drafting';
  if (/planning/i.test(detail)) return 'Planning';
  const drafty = Boolean(job && job.essayBusy);
  return drafty ? 'Matching' : 'Essays';
}

function ensureSteps() {
  if (stepsEl.childElementCount) return;
  STEPS.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'step is-upcoming';
    li.dataset.step = s.id;
    li.title = s.title;
    const mark = document.createElement('span');
    mark.className = 'step-mark';
    mark.textContent = String(i + 1);
    const label = document.createElement('span');
    label.className = 'step-label';
    label.textContent = s.id;
    li.append(mark, label);
    stepsEl.appendChild(li);
  });
}

function renderSteps(job) {
  if (!stepsEl) return;
  ensureSteps();
  const currentStep = (job && job.autofillStep) || '';
  const status = (job && job.autofillStatus) || 'idle';
  const kind = (job && job.runKind) || '';
  const essaysOnly = kind === 'essays';
  const jdOnly = kind === 'jd';
  const resumeOnly = kind === 'resume';
  const fillOnly = kind === 'fill';
  const idx = STEPS.findIndex((s) => s.id === currentStep);
  const complete = currentStep === 'Done' && status !== 'running';
  stepsEl.classList.toggle('is-running', status === 'running');
  stepsEl.classList.toggle('is-complete', complete);
  [...stepsEl.children].forEach((li, i) => {
    const id = STEPS[i].id;
    let state;
    if (jdOnly && id !== 'JD' && id !== 'Done') {
      state = 'skipped';
    } else if (resumeOnly && id !== 'Apply?' && id !== 'Done') {
      state = 'skipped';
    } else if (fillOnly && (id === 'Review' || id === 'Essays')) {
      state = 'skipped';
    } else if (essaysOnly && (id === 'Fill' || id === 'Review')) {
      state = 'skipped';
    } else if (id === 'Review' && job && job.reviewCancellable && job.runKind === 'all' && status === 'running') {
      state = 'current';
    } else if (id === 'Review' && job && job.skippedReview && (complete || idx > i)) {
      state = 'skipped';
    } else if (complete || (idx >= 0 && i < idx)) {
      state = 'done';
    } else if (idx === i) {
      state = status === 'error' ? 'error' : 'current';
    } else {
      state = 'upcoming';
    }
    li.className = `step is-${state}`;
    if (state === 'current' || state === 'error') li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
    li.querySelector('.step-mark').textContent =
      state === 'done' ? '✓' : state === 'skipped' ? '–' : String(i + 1);
    const label = li.querySelector('.step-label');
    if (STEPS[i].id === 'Essays' && state === 'current' && status === 'running') {
      label.textContent = essayStepLabel(job);
    } else if (STEPS[i].id === 'Review' && state === 'current' && status === 'running') {
      label.textContent = 'Reviewing';
    } else {
      label.textContent = STEPS[i].id;
    }
  });
  if (progressEl) progressEl.hidden = status !== 'running';
  if (status === 'running') {
    const cur = stepsEl.querySelector('.is-current');
    if (cur && typeof cur.scrollIntoView === 'function') {
      cur.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }
}

function canTogglePosting(job) {
  const bucket = job && job.bucket;
  return bucket === 'submitted' || bucket === 'passed';
}

function render(payload) {
  const job = payload || null;
  const nextKey = conversationComposeKey(job);
  if (chatInput && lastComposeKey && lastComposeKey !== nextKey) {
    composeByTab.set(lastComposeKey, chatInput.value);
  }
  if (chatInput && nextKey !== lastComposeKey) {
    chatInput.value = (nextKey && composeByTab.get(nextKey)) || '';
  }
  lastComposeKey = nextKey || null;
  current = job;
  applyHandedness((job && job.handedness) || (job && job.conversation && job.conversation.handedness));
  const huntBar = document.getElementById('hunt-login');
  const huntCopy = document.getElementById('hunt-login-copy');
  if (huntBar) {
    const login = payload && payload.huntLogin;
    huntBar.hidden = !login;
    if (huntCopy) huntCopy.textContent = (login && login.prompt) || '';
  }
  if (payload && payload.model) applyModelSnapshot(payload.model);
  const open = job && job.bucket === 'open' && job.id !== '__hunt__';
  const status = (job && job.autofillStatus) || 'idle';
  const detail = (job && job.autofillDetail) || '';
  const busy = Boolean(job && job.autofillStatus === 'running');
  if (completeEl) completeEl.disabled = !open;
  if (passEl) passEl.disabled = !open;
  const footerActions = document.querySelector('.footer-actions');
  if (footerActions) footerActions.hidden = !open;
  if (autofillStagesEl) autofillStagesEl.hidden = !open || !stagesOpen;
  if (companyEl) companyEl.textContent = job ? text(job.name) : '—';
  if (titleEl) titleEl.textContent = job ? text(job.title, '') : '';
  if (salaryEl) salaryEl.textContent = job ? text(job.salary) : '—';
  if (yoeEl) yoeEl.textContent = job ? text(job.yoe) : '—';
  if (levelEl) levelEl.textContent = job ? text(job.level) : '—';
  if (resumeLabel) resumeLabel.textContent = job && job.resume ? job.resume.label : '—';
  if (resumeChip) resumeChip.classList.toggle('is-uploaded', Boolean(job && job.resumeUploaded));
  if (sessionCounts) {
    sessionCounts.textContent = job
      ? `session ${job.sessionSubmitted || 0} in · ${job.sessionPassed || 0} pass · ${job.sessionRejected || 0} no`
      : '';
    sessionCounts.classList.remove('is-alert');
  }
  const reviewing = isReviewing(job);
  const parallelReview = isParallelReview(job);
  const reviewCopy = parallelReview && job && job.essayBusy
    ? detail && /reviewing leftovers/i.test(detail)
      ? detail
      : 'Drafting essays · reviewing leftovers…'
    : detail && /reviewing leftovers/i.test(detail) && !/matching experience|drafting essays/i.test(detail)
      ? detail
      : 'LLM is reviewing leftovers…';
  if (autofillEl) autofillEl.disabled = !open;
  if (autofillMenuEl) autofillMenuEl.disabled = !open;
  if (fillStatusEl) {
    const line = reviewing ? reviewCopy : detail;
    fillStatusEl.hidden = !line;
    fillStatusEl.textContent = line || '';
    fillStatusEl.classList.toggle('is-review', reviewing);
  }
  if (runStatusEl) {
    runStatusEl.hidden = !reviewing;
    runStatusEl.textContent = reviewing ? reviewCopy : '';
  }
  if (surfaceSwitch) {
    const closed = canTogglePosting(job);
    surfaceSwitch.hidden = !closed;
    const onDash = !job || job.mode !== 'ats';
    surfaceSwitch.textContent = onDash ? 'Posting' : 'Dashboard';
  }
  const runKind = (job && job.runKind) || '';
  if (autofillEl) {
    autofillEl.classList.toggle('is-cancel', busy);
    autofillEl.classList.toggle('is-error', status === 'error');
    autofillEl.textContent = busy ? 'Cancel' : status === 'error' ? 'Retry' : 'Autofill';
    autofillEl.title = busy
      ? 'Stop this run (⌘D)'
      : status === 'error'
        ? 'Retry JD, resume, fill, and essay (⌘D)'
        : 'JD, resume, fill, and essay (⌘D)';
  }
  if (autofillMenuEl) {
    autofillMenuEl.classList.toggle('is-open', stagesOpen);
    autofillMenuEl.classList.toggle('is-cancel', busy);
    autofillMenuEl.setAttribute('aria-expanded', String(stagesOpen));
  }
  if (autofillStagesEl) {
    autofillStagesEl.querySelectorAll('[data-stage]').forEach((btn) => {
      const stage = btn.dataset.stage;
      const active = busy && (runKind === stage || (stage === 'essay' && runKind === 'essays'));
      btn.classList.toggle('is-running', active);
      btn.classList.toggle('is-error', status === 'error' && (runKind === stage || (stage === 'essay' && runKind === 'essays')));
      btn.disabled = !open;
    });
  }
  const scan = job && job.jd && job.jd.findings;
  if (scan && scan.hasAlerts) {
    jdAlertsEl.hidden = false;
    jdAlertsEl.textContent = (scan.findings || []).map((f) => f.summary).join(' · ');
  } else {
    jdAlertsEl.hidden = true;
  }
  if (!isFooterShell && !isDockShell) renderSteps(job);
  if (isDrawerShell) {
    const conv = conversationOf(job);
    if (conv && conv.pageRail && conv.pageSubtab) applyRailTab(conv.pageSubtab, { silent: true });
    else applyRailTab(railTab, { silent: true });
    renderConversationRail(job);
    renderOpenBar(job);
    renderIngestPlan(job);
    renderJdBody((job && job.jd && job.jd.text) || '');
    renderPostingUrl((job && job.posting) || '');
    renderReviewPin(job);
    renderChat(job);
    tryFlushVisibleChats();
  }
}

function fieldForAsk(job, ask) {
  const fields = (job && job.debugFields) || [];
  if (ask && ask.id) {
    const hit = fields.find((f) => f.id === ask.id);
    if (hit) return hit;
  }
  const q = String((ask && ask.question) || '').toLowerCase();
  if (!q) return null;
  return fields.find((f) => {
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

function reviewEmpty() {
  const empty = document.createElement('div');
  empty.className = 'chat-empty';
  empty.textContent = 'Nothing needs you. Open All to see how Autofill routed, mapped, and wrote each field.';
  return empty;
}

function reviewWaitingBanner(job) {
  const box = document.createElement('div');
  box.className = 'review-waiting';
  box.setAttribute('role', 'status');
  const mark = document.createElement('div');
  mark.className = 'review-waiting-mark';
  const copy = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'review-waiting-title';
  const parallel = isParallelReview(job);
  title.textContent = parallel ? 'Reviewing leftovers' : 'LLM is reviewing leftovers';
  const why = document.createElement('div');
  why.className = 'review-waiting-why';
  why.textContent = parallel
    ? job && job.essayBusy
      ? 'Essays are already drafting. Cancel review if you do not want leftover suggestions.'
      : 'Cancel review if you do not want leftover suggestions.'
    : 'Skip to draft essays, or Fill all to stop here.';
  const actions = document.createElement('div');
  actions.className = 'review-waiting-actions';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = parallel ? 'btn btn-all' : 'btn btn-essay';
  skip.textContent = parallel ? 'Cancel review' : 'Skip to essay';
  skip.disabled = !canCancelReview(job);
  skip.addEventListener('click', () => {
    if (job && window.magnetChrome.reviewCancel) window.magnetChrome.reviewCancel(actionJobId(job), { stop: false });
  });
  actions.append(skip);
  if (!parallel) {
    const fillAll = document.createElement('button');
    fillAll.type = 'button';
    fillAll.className = 'btn btn-autofill';
    fillAll.textContent = 'Fill all';
    fillAll.disabled = !canCancelReview(job);
    fillAll.addEventListener('click', () => {
      if (job && window.magnetChrome.reviewCancel) window.magnetChrome.reviewCancel(actionJobId(job), { stop: true });
    });
    actions.append(fillAll);
  }
  copy.append(title, why, actions);
  box.append(mark, copy);
  return box;
}

function copyApi() {
  return window.MagnetReviewCopy || {};
}

function controlApi() {
  return window.MagnetReviewControl || {};
}

function insightApi() {
  return window.MagnetReviewInsight || {};
}

function liveReviewField(job, row) {
  const live = fieldForFill(job, row);
  if (live && row) {
    return {
      ...row,
      ...live,
      label: row.label || live.label,
      gate: row.gate || live.gate,
      value: row.value != null && String(row.value).trim() !== '' ? row.value : live.intended || live.value,
    };
  }
  return live || row;
}

function renderReviewPipeline(job, row) {
  const api = insightApi();
  if (!api.pipelineLines) return null;
  const field = liveReviewField(job, row);
  const lines = api.pipelineLines(row || field, {
    field,
    cache: job && job.strategyCache,
    gate: (row && row.gate) || (field && field.gate),
  });
  if (!lines.length) return null;
  const dl = document.createElement('dl');
  dl.className = 'review-pipeline';
  for (const line of lines) {
    const dt = document.createElement('dt');
    dt.textContent = line.k;
    const dd = document.createElement('dd');
    dd.textContent = line.v;
    dl.append(dt, dd);
  }
  return dl;
}

function strategyPickKey(job, fieldId) {
  return `${actionJobId(job)}:${fieldId}:strategy`;
}

function renderStrategyPicker(job, field) {
  const api = insightApi();
  const wrap = document.createElement('label');
  wrap.className = 'review-strategy-pick';
  const lab = document.createElement('span');
  lab.textContent = 'Write with';
  const sel = document.createElement('select');
  sel.className = 'review-strategy-select';
  sel.setAttribute('aria-label', 'Choose a fill strategy for ' + ((field && (field.label || field.id)) || 'field'));
  const key = strategyPickKey(job, field && field.id);
  const choices = api.strategyChoices ? api.strategyChoices(liveReviewField(job, field), job && job.strategyCache) : [];
  const picked = reviewStrategyPick.has(key) ? reviewStrategyPick.get(key) : '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Full chain';
  if (!picked) blank.selected = true;
  sel.appendChild(blank);
  for (const c of choices) {
    const opt = document.createElement('option');
    opt.value = c.name;
    const score = c.wins || c.losses ? ` ${c.wins}–${c.losses}` : '';
    const mark = c.won ? ' landed' : c.last ? ' usual' : '';
    opt.textContent = `${c.label}${score}${mark}`;
    if (picked && c.name === picked) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('click', (e) => e.stopPropagation());
  sel.addEventListener('change', () => reviewStrategyPick.set(key, sel.value));
  wrap.append(lab, sel);
  wrap.getValue = () => sel.value;
  wrap.setDisabled = (on) => {
    sel.disabled = on;
  };
  return wrap;
}

function renderReviewLevers(job, field, extra) {
  const opts = extra || {};
  const host = opts.host || document.createElement('div');
  const picker = opts.showStrategy === false ? null : renderStrategyPicker(job, field);
  const write = document.createElement('button');
  write.type = 'button';
  write.className = 'btn btn-ghost';
  write.textContent = opts.writeLabel || 'Retry';
  write.title = opts.writeTitle || 'Write this value again with the selected strategy';
  const notice = document.createElement('button');
  notice.type = 'button';
  notice.className = 'btn btn-ghost';
  notice.textContent = "ATS didn't notice";
  notice.title = 'Demote the last strategy for this widget and reopen the leftover';
  let wrong = null;
  if (opts.showWrong) {
    wrong = document.createElement('button');
    wrong.type = 'button';
    wrong.className = 'btn btn-ghost';
    wrong.textContent = 'Wrong value';
    wrong.title = 'This page value is wrong — open it as a leftover';
  }
  const setBusy = (on) => {
    write.disabled = on;
    notice.disabled = on;
    if (wrong) wrong.disabled = on;
    if (picker && picker.setDisabled) picker.setDisabled(on);
    if (opts.onBusy) opts.onBusy(on);
  };
  const retry = async (payload) => {
    if (!window.magnetChrome.reviewRetry) return { ok: false, error: 'Retry is unavailable' };
    return window.magnetChrome.reviewRetry(actionJobId(job), field.id, {
      strategy: payload.strategy || '',
      value: payload.value,
      flag: payload.flag || '',
      label: field.label || '',
    });
  };
  write.addEventListener('click', async (e) => {
    e.stopPropagation();
    setBusy(true);
    const out = await retry({
      strategy: picker ? picker.getValue() : '',
      value: opts.getValue ? opts.getValue() : field.intended || field.value,
    });
    if (!out || !out.ok) {
      setBusy(false);
      toast((out && (out.error || (out.result && out.result.reason))) || 'Retry did not land');
    }
  });
  notice.addEventListener('click', async (e) => {
    e.stopPropagation();
    setBusy(true);
    const out = await retry({ flag: 'filled_but_not_touched' });
    if (!out || (!out.ok && !out.open_review)) {
      setBusy(false);
      toast((out && out.error) || 'Could not flag that field');
    }
  });
  if (wrong) {
    wrong.addEventListener('click', async (e) => {
      e.stopPropagation();
      setBusy(true);
      const out = await retry({ flag: 'wrong_value' });
      if (!out || (!out.ok && !out.open_review)) {
        setBusy(false);
        toast((out && out.error) || 'Could not mark that value wrong');
      }
    });
  }
  if (picker) host.appendChild(picker);
  host.append(write, notice);
  if (wrong) host.appendChild(wrong);
  return host;
}

function cardKind(row, extra) {
  return (copyApi().reviewCardKind || (() => 'Needs an answer'))(row, extra);
}

function cardWhy(row, extra) {
  return (copyApi().reviewCardWhy || (() => ''))(row, extra);
}

function chatPlaceholder() {
  return (copyApi().reviewChatPlaceholder || (() => 'Ask Magnet about this field…'))();
}

function isFactReviewRow(row) {
  const reason = String((row && row.reason) || '');
  if (
    row &&
    (row.gate === 'inferred' ||
      row.gate === 'needs-infer' ||
      row.gate === 'fuzzy' ||
      row.gate === 'no-fact' ||
      row.gate === 'unlabeled' ||
      row.gate === 'wrong-intended')
  ) {
    return true;
  }
  if (/no fact|unlabeled|inferred|needs-infer|wrong intended|magnet put|wrong value/i.test(reason)) return true;
  const ops = ((row && row.steps) || [])
    .map((s) => s && s.op)
    .filter((op) => op && op !== 'wait' && op !== 'poke');
  if (ops.length && ops.every((op) => op === 'clickOption')) return true;
  if (!String((row && row.value) || '').trim()) return true;
  if (!((row && row.steps) || []).length) return true;
  return false;
}

function formatReviewStep(step) {
  if (!step || !step.op) return '';
  if (step.op === 'click') return step.selector ? 'click ' + step.selector : 'click';
  if (step.op === 'wait') return 'wait ' + (Number(step.ms) || 200) + 'ms';
  if (step.op === 'clickOption') return 'click option';
  return String(step.op);
}

function fieldForFill(job, row) {
  return ((job && job.debugFields) || []).find((f) => f.id === (row && row.id)) || null;
}

function reviewFieldOf(job, row) {
  const live = fieldForFill(job, row);
  if (live) return live;
  if (row && (row.options || row.type || row.tag || row.select || row.reactSelect || row.shape)) return row;
  return null;
}

function reviewControlOf(field) {
  const api = controlApi();
  if (api.reviewControl) return api.reviewControl(field);
  return { kind: 'text', options: [] };
}

function bindReviewDraft(el, draftKey, remember) {
  if (!el) return;
  el.addEventListener('input', () => {
    acceptDrafts.set(draftKey, el.value);
    if (remember) remember();
  });
  el.addEventListener('change', () => {
    acceptDrafts.set(draftKey, el.value);
    if (remember) remember();
  });
  if (remember) {
    el.addEventListener('focus', remember);
    el.addEventListener('select', remember);
    el.addEventListener('mouseup', remember);
    el.addEventListener('keyup', remember);
  }
}

function renderReviewValueControl(field, current, draftKey) {
  const spec = reviewControlOf(field);
  const api = controlApi();
  const options = spec.options || [];
  const listed = api.withCurrentOption ? api.withCurrentOption(options, current) : options;
  const matched = api.matchReviewOption ? api.matchReviewOption(listed, current) : current;
  const chosen = api.selectedReviewChoices ? api.selectedReviewChoices(listed, current) : (matched ? [matched] : []);
  const label = (field && (field.label || field.id)) || 'answer';

  if (spec.kind === 'select') {
    const sel = document.createElement('select');
    sel.className = 'review-value-input review-value-select';
    sel.setAttribute('aria-label', 'Choose answer for ' + label);
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select…';
    sel.appendChild(blank);
    for (const opt of listed) {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (matched && opt === matched) option.selected = true;
      sel.appendChild(option);
    }
    bindReviewDraft(sel, draftKey);
    return { el: sel, kind: spec.kind, isText: false };
  }

  if (spec.kind === 'radios' || spec.kind === 'checkboxes') {
    const wrap = document.createElement('div');
    wrap.className = 'review-choices';
    wrap.setAttribute('role', spec.kind === 'radios' ? 'radiogroup' : 'group');
    wrap.setAttribute('aria-label', 'Choose answer for ' + label);
    const name = 'review-' + draftKey.replace(/[^a-z0-9]+/gi, '-');
    const boxes = [];
    for (const opt of listed) {
      const lab = document.createElement('label');
      lab.className = 'review-choice';
      const input = document.createElement('input');
      input.type = spec.kind === 'radios' ? 'radio' : 'checkbox';
      input.name = name;
      input.value = opt;
      input.checked = chosen.includes(opt);
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('change', () => {
        const next =
          spec.kind === 'radios'
            ? input.value
            : boxes.filter((b) => b.checked).map((b) => b.value).join(', ');
        acceptDrafts.set(draftKey, next);
      });
      const text = document.createElement('span');
      text.textContent = opt;
      lab.append(input, text);
      wrap.appendChild(lab);
      boxes.push(input);
    }
    return {
      el: wrap,
      kind: spec.kind,
      isText: false,
      getValue: () =>
        spec.kind === 'radios'
          ? (boxes.find((b) => b.checked) || { value: '' }).value
          : boxes.filter((b) => b.checked).map((b) => b.value).join(', '),
      setDisabled: (on) => {
        boxes.forEach((b) => {
          b.disabled = on;
        });
      },
    };
  }

  if (spec.kind === 'checkbox') {
    const wrap = document.createElement('label');
    wrap.className = 'review-choice review-choice-single';
    const input = document.createElement('input');
    input.type = 'checkbox';
    const onVal = listed[0] && !/^(off|false|no)$/i.test(listed[0]) ? listed[0] : 'Yes';
    input.checked = Boolean(chosen.length) || /^(yes|on|true|1)$/i.test(String(current || '').trim());
    input.setAttribute('aria-label', label);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      acceptDrafts.set(draftKey, input.checked ? onVal : '');
    });
    const text = document.createElement('span');
    text.textContent = listed[0] || 'Yes';
    wrap.append(input, text);
    return {
      el: wrap,
      kind: spec.kind,
      isText: false,
      getValue: () => (input.checked ? onVal : ''),
      setDisabled: (on) => {
        input.disabled = on;
      },
    };
  }

  const val = spec.kind === 'textarea' ? document.createElement('textarea') : document.createElement('input');
  if (spec.kind === 'textarea') {
    val.rows = 3;
  } else {
    val.type = spec.kind === 'file' ? 'text' : spec.kind;
  }
  val.className = 'review-value-input';
  val.spellcheck = spec.kind === 'textarea';
  val.setAttribute('aria-label', (spec.kind === 'file' ? 'File name for ' : 'Edit answer for ') + label);
  val.value = current || '';
  const remember = () => {
    acceptFocusKey = draftKey;
    acceptCaret = val.selectionStart || 0;
    acceptSelEnd = val.selectionEnd || acceptCaret;
  };
  bindReviewDraft(val, draftKey, remember);
  return { el: val, kind: spec.kind, isText: true };
}

function reviewQuestionKey(row) {
  return String((row && (row.label || row.question)) || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeReviewRows(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    if (!row) continue;
    const key = reviewQuestionKey(row);
    if (key.length >= 16) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(row);
  }
  return out;
}

function renderReviewSummary(job, counts) {
  const api = insightApi();
  const box = document.createElement('div');
  box.className = 'review-summary';
  const title = document.createElement('div');
  title.className = 'review-summary-title';
  title.textContent = counts.all ? 'How Autofill treated this page' : 'Autofill review';
  const tally = document.createElement('div');
  tally.className = 'review-summary-tally';
  tally.textContent = counts.all
    ? `${counts.filled} filled · ${counts.leftover} leftover · ${counts.essay} essay · ${counts.skip} skipped`
    : 'Run Autofill to inventory this form.';
  const why = document.createElement('p');
  why.className = 'review-summary-why';
  why.textContent =
    'Route the question, map a profile fact onto a page option, then write it with the winning strategy for that widget. Leftovers are missing facts, missed writes, or unsure matches.';
  const filters = document.createElement('div');
  filters.className = 'review-filters';
  filters.setAttribute('role', 'tablist');
  filters.setAttribute('aria-label', 'Review field filter');
  const list = api.FILTERS || [
    { id: 'need', label: 'Needs you' },
    { id: 'all', label: 'All' },
    { id: 'filled', label: 'Filled' },
    { id: 'essay', label: 'Essays' },
    { id: 'skip', label: 'Skipped' },
  ];
  for (const f of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'review-filter' + (reviewFilter === f.id ? ' is-on' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(reviewFilter === f.id));
    const n = f.id === 'need' ? counts.need : f.id === 'all' ? counts.all : counts[f.id] || 0;
    btn.textContent = n ? `${f.label} ${n}` : f.label;
    btn.addEventListener('click', () => {
      reviewFilter = f.id;
      renderReviewPin(job);
    });
    filters.appendChild(btn);
  }
  box.append(title, tally, why, filters);
  return box;
}

function renderInventoryRow(job, field) {
  const api = insightApi();
  const bucket = api.fieldBucket ? api.fieldBucket(field) : 'other';
  const details = document.createElement('details');
  details.className = 'review-row review-inventory-row is-' + bucket;
  details.dataset.fieldId = field.id;
  if (reviewOpenIds.has(field.id) || job.reviewFocus === field.id || job.focusedFieldId === field.id) {
    details.open = true;
  }
  details.addEventListener('toggle', () => {
    if (details.open) reviewOpenIds.add(field.id);
    else reviewOpenIds.delete(field.id);
  });
  const summary = document.createElement('summary');
  summary.className = 'review-inventory-summary';
  const dot = document.createElement('span');
  dot.className = 'review-dot';
  const lab = document.createElement('span');
  lab.className = 'review-inventory-label';
  lab.textContent = api.inventoryLabel ? api.inventoryLabel(field) : field.label || field.id;
  const val = document.createElement('span');
  val.className = 'review-inventory-value';
  val.textContent = api.inventoryValue ? api.inventoryValue(field) : '';
  const mark = document.createElement('span');
  mark.className = 'review-inventory-mark';
  mark.textContent = (field.fill && field.fill.strategy) || field.route || bucket;
  summary.append(dot, lab, val, mark);
  const body = document.createElement('div');
  body.className = 'review-inventory-body';
  const pipe = renderReviewPipeline(job, field);
  if (pipe) body.appendChild(pipe);
  const tools = document.createElement('div');
  tools.className = 'review-actions';
  tools.appendChild(renderFocusButton(details, job, field.id));
  renderReviewLevers(job, field, {
    host: tools,
    showWrong: bucket === 'filled',
    getValue: () => field.intended || field.current || field.value || '',
  });
  body.appendChild(tools);
  details.append(summary, body);
  return details;
}

function collectReviewRows(job) {
  const review = job && job.review;
  const fills = ((review && review.fills) || []).filter((f) => !f.accepted && !f.dismissed);
  const asks = ((review && review.asks) || []).filter((a) => !a.answered);
  const askFills = asks
    .map((a) => {
      const field = fieldForAsk(job, a);
      if (!field || fills.some((f) => f.id === field.id || reviewQuestionKey(f) === reviewQuestionKey(field))) {
        return null;
      }
      const blob = `${a.question || ''} ${a.why || ''} ${field.label || ''}`.toLowerCase();
      if (!/consent|opt-?in|brighthire|whatsapp|sms|recording|yes or no/.test(blob)) return null;
      const opts = ((field && field.options) || [])
        .map((o) => String((o && (o.text || o.label || o.value)) || o).trim())
        .filter(Boolean);
      const guess =
        opts.find((t) => /^(yes|i consent|i agree|consent)$/i.test(t)) ||
        opts.find((t) => /^yes\b/i.test(t)) ||
        '';
      return {
        id: field.id,
        label: a.question || field.label || field.id,
        value: guess,
        reason: a.why || '',
        type: field.type,
        tag: field.tag,
        options: field.options,
        select: field.select,
        reactSelect: field.reactSelect,
        shape: field.shape,
      };
    })
    .filter(Boolean);
  const factAskRows = asks
    .filter((a) => a.reason === 'no-fact' || a.reason === 'unlabeled')
    .map((a) => {
      const field = fieldForAsk(job, a) || { id: a.id, label: a.question };
      if (!field || fills.some((f) => f.id === field.id || reviewQuestionKey(f) === reviewQuestionKey(field))) {
        return null;
      }
      return {
        id: field.id,
        label: a.question || field.label || field.id,
        value: a.pageValue || field.current || field.value || '',
        reason: a.why || '',
        gate: a.reason || '',
        pageValue: a.pageValue || field.current || field.value || field.prefill || '',
        type: field.type,
        tag: field.tag,
        options: field.options,
        select: field.select,
        reactSelect: field.reactSelect,
        shape: field.shape,
      };
    })
    .filter(Boolean);
  const leftoverRows = (copyApi().leftoverReviewRows || (() => []))(
    job && job.debugFields,
    fills.concat(askFills, factAskRows)
  );
  const acceptRows = dedupeReviewRows(fills.concat(askFills, factAskRows, leftoverRows));
  const chatAsks = asks.filter((a) => {
    if (a.reason === 'no-fact' || a.reason === 'unlabeled') return false;
    const fid = fieldForAsk(job, a) && fieldForAsk(job, a).id;
    return !askFills.some((f) => f.id === fid) && !factAskRows.some((f) => f.id === fid);
  });
  const runs = ((review && review.runs) || []).filter((r) => !r.accepted && !r.dismissed);
  const recipes = ((review && review.recipes) || []).filter((r) => !r.accepted && !r.dismissed);
  const notes = [...((job && job.reviewNotes) || [])];
  const reply = review && review.reply ? String(review.reply).trim() : '';
  if (
    reply &&
    !notes.includes(reply) &&
    reply.split('\n').some((line) => line.trim() && !notes.includes(line.trim()))
  ) {
    notes.unshift(reply);
  }
  const unsures = ((review && review.uncertainties) || []).filter((u) => u && u.reason);
  return { fills, asks, leftoverRows, acceptRows, chatAsks, runs, recipes, notes, unsures };
}

function renderReviewPin(job) {
  if (!reviewRoot) return;
  const packed = collectReviewRows(job);
  const { acceptRows, chatAsks, runs, recipes, notes, unsures, leftoverRows, fills, asks } = packed;
  const api = insightApi();
  const counts = api.reviewCounts ? api.reviewCounts(job && job.debugFields) : { all: 0, filled: 0, leftover: 0, essay: 0, skip: 0, need: leftoverRows.length };
  if (counts.need < leftoverRows.length) counts.need = leftoverRows.length;
  if (acceptRows.length > counts.need) counts.need = acceptRows.length;
  const reviewing = isReviewing(job);
  const hasNeed =
    fills.length ||
    asks.length ||
    runs.length ||
    recipes.length ||
    notes.length ||
    unsures.length ||
    leftoverRows.length ||
    acceptRows.length;
  reviewRoot.replaceChildren();
  const pin = document.createElement('div');
  pin.className = 'review-pin';
  pin.appendChild(renderReviewSummary(job, counts));
  if (reviewing) pin.appendChild(reviewWaitingBanner(job));
  if (reviewFilter === 'need') {
    if (notes.length) {
      for (const note of notes) {
        const line = document.createElement('div');
        line.className = 'review-note';
        line.textContent = note;
        pin.appendChild(line);
      }
    }
    for (const u of unsures) {
      if (notes.includes(`Unsure · ${u.label}: ${u.reason}`)) continue;
      const line = document.createElement('div');
      line.className = 'review-note review-unsure';
      line.textContent = `Unsure · ${u.label}: ${u.reason}`;
      pin.appendChild(line);
    }
    for (const f of acceptRows) {
      pin.appendChild(isFactReviewRow(f) ? renderFactCard(job, f) : renderStrategyCard(job, f));
    }
    for (const a of chatAsks) {
      const row = document.createElement('div');
      row.className = 'review-ask';
      const q = document.createElement('div');
      q.className = 'review-label';
      q.textContent = a.question;
      const why = document.createElement('div');
      why.className = 'review-why';
      why.textContent = a.why || 'Reply in chat to answer.';
      row.append(q, why);
      pin.appendChild(row);
    }
    for (const r of runs) {
      pin.appendChild(renderScriptCard(job, r));
    }
    for (const r of recipes) {
      pin.appendChild(renderRecipeCard(job, r));
    }
    if (!hasNeed && !reviewing) pin.appendChild(reviewEmpty());
  } else {
    const list = api.filterFields ? api.filterFields(job && job.debugFields, reviewFilter) : job && job.debugFields;
    const wrap = document.createElement('div');
    wrap.className = 'review-inventory';
    for (const field of list || []) {
      wrap.appendChild(renderInventoryRow(job, field));
    }
    if (!wrap.childElementCount) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty';
      empty.textContent =
        reviewFilter === 'all'
          ? 'No inventoried fields yet. Run Autofill to see the classify → map → write path.'
          : 'Nothing in this filter.';
      wrap.appendChild(empty);
    }
    pin.appendChild(wrap);
  }
  reviewRoot.appendChild(pin);
}

function reviewChatKey(job, fieldId) {
  return `${actionJobId(job)}:${fieldId}:chat`;
}

function markReviewFocus(row) {
  document.querySelectorAll('.review-row.is-focus').forEach((n) => {
    if (n !== row) n.classList.remove('is-focus', 'is-flash');
  });
  row.classList.add('is-focus');
}

function locateSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  return svg;
}

function renderFocusButton(row, job, fieldId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-locate';
  btn.title = 'Show this field on the page';
  btn.setAttribute('aria-label', 'Show this field on the page');
  btn.appendChild(locateSvg());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    markReviewFocus(row);
    window.magnetChrome.debugFocus(actionJobId(job), fieldId);
  });
  return btn;
}

function renderRecordButton(job, fieldId) {
  const rec = job.fillRecord && job.fillRecord.fieldId === fieldId ? job.fillRecord : null;
  const recording = rec && rec.status === 'recording';
  const verifying = rec && rec.status === 'verifying';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-record' + (recording ? ' is-stop' : '');
  btn.title = recording ? 'Stop recording' : 'Record your fill on the page';
  btn.setAttribute('aria-label', recording ? 'Stop recording' : 'Record fill');
  btn.disabled = verifying;
  const mark = document.createElement('span');
  mark.className = recording ? 'btn-record-stop' : 'btn-record-dot';
  btn.appendChild(mark);
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    const out = recording
      ? await window.magnetChrome.reviewRecordStop(actionJobId(job), fieldId)
      : await window.magnetChrome.reviewRecordStart(actionJobId(job), fieldId);
    if (!out || !out.ok) {
      btn.disabled = false;
      toast((out && out.error) || (recording ? 'Could not stop recording' : 'Could not start recording'));
    }
  });
  return btn;
}

function attachFieldChat(job, fieldId, host) {
  const box = document.createElement('div');
  box.className = 'review-field-chat';
  const chat = ((job.reviewFieldChats || {})[fieldId]) || {};
  if (chat.you) {
    const you = document.createElement('div');
    you.className = 'review-field-chat-you';
    you.textContent = chat.you;
    box.appendChild(you);
  }
  if (chat.reply) {
    const reply = document.createElement('div');
    reply.className = 'review-field-chat-reply';
    reply.textContent = chat.reply;
    box.appendChild(reply);
  }
  if (chat.error) {
    const err = document.createElement('div');
    err.className = 'review-field-chat-error';
    err.textContent = chat.error;
    box.appendChild(err);
  }
  const row = document.createElement('div');
  row.className = 'review-field-chat-row';
  const ta = document.createElement('textarea');
  ta.className = 'review-chat-input';
  ta.rows = 2;
  ta.spellcheck = true;
  ta.placeholder = chatPlaceholder();
  ta.setAttribute('aria-label', 'Ask Magnet about this field');
  const draftKey = reviewChatKey(job, fieldId);
  ta.value = reviewChatDrafts.has(draftKey) ? reviewChatDrafts.get(draftKey) : '';
  ta.disabled = Boolean(chat.busy);
  ta.addEventListener('input', () => reviewChatDrafts.set(draftKey, ta.value));
  ta.addEventListener('click', (e) => e.stopPropagation());
  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'btn btn-ghost review-chat-send';
  send.textContent = chat.busy ? 'Thinking…' : 'Ask';
  send.disabled = Boolean(chat.busy);
  const submit = async () => {
    const next = String(ta.value || '').trim();
    if (!next || chat.busy) return;
    send.disabled = true;
    ta.disabled = true;
    send.textContent = 'Thinking…';
    reviewChatDrafts.delete(draftKey);
    const out = await window.magnetChrome.reviewChat(actionJobId(job), fieldId, next);
    if (!out || !out.ok) {
      reviewChatDrafts.set(draftKey, next);
      send.disabled = false;
      ta.disabled = false;
      send.textContent = 'Ask';
      toast((out && out.error) || 'Could not ask about that field');
    }
  };
  send.addEventListener('click', (e) => {
    e.stopPropagation();
    submit();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      submit();
    }
  });
  row.append(ta, send);
  box.appendChild(row);
  host.appendChild(box);
}

function renderFactCard(job, f) {
  const rec = job.fillRecord && job.fillRecord.fieldId === f.id ? job.fillRecord : null;
  const recording = rec && rec.status === 'recording';
  const field = reviewFieldOf(job, f);
  const spec = reviewControlOf(field);
  const extra = {
    recording,
    verifying: rec && rec.status === 'verifying',
    failed: rec && rec.status === 'failed',
    error: rec && rec.error,
    control: spec.kind,
  };
  const row = document.createElement('div');
  row.className =
    'review-row review-field ' +
    (copyApi().reviewKindClass ? copyApi().reviewKindClass(f, extra) : 'review-kind-empty') +
    (job.reviewFocus === f.id || job.focusedFieldId === f.id || recording ? ' is-focus' : '') +
    (job.reviewFlashId === f.id ? ' is-flash' : '') +
    (recording ? ' is-recording' : '');
  row.dataset.fieldId = f.id;
  if (job.reviewFlashId === f.id) {
    requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }));
  }
  const meta = document.createElement('div');
  meta.className = 'review-meta';
  const head = document.createElement('div');
  head.className = 'review-head';
  const kind = document.createElement('div');
  kind.className = 'review-kind';
  kind.textContent = cardKind(f, extra);
  head.append(kind, renderFocusButton(row, job, f.id));
  const lab = document.createElement('div');
  lab.className = 'review-label';
  lab.textContent = f.label || f.id;
  const draftKey = `${job.id}:${f.id}`;
  const current = acceptDrafts.has(draftKey) ? acceptDrafts.get(draftKey) : f.value || '';
  const control = renderReviewValueControl(field, current, draftKey);
  const val = control.el;
  const readValue = () => (control.getValue ? control.getValue() : val.value);
  const setDisabled = (on) => {
    if (control.setDisabled) control.setDisabled(on);
    else val.disabled = on;
  };
  const why = document.createElement('div');
  why.className = 'review-why';
  why.textContent = cardWhy(f, extra);
  meta.append(head, lab, val, why);
  const pipe = renderReviewPipeline(job, f);
  if (pipe) meta.appendChild(pipe);
  attachFieldChat(job, f.id, meta);
  const actions = document.createElement('div');
  actions.className = 'review-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary review-accept';
  btn.textContent = 'Save';
  btn.title = 'Write this answer and remember it for this question type';
  const accept = async () => {
    btn.disabled = true;
    setDisabled(true);
    const next = readValue();
    acceptDrafts.delete(draftKey);
    if (acceptFocusKey === draftKey) acceptFocusKey = '';
    const out = await window.magnetChrome.reviewAccept(actionJobId(job), f.id, next, f.steps, f.label, {
      classId: f.class_id || f.class || '',
    });
    if (!out || !out.ok) {
      btn.disabled = false;
      setDisabled(false);
      toast((out && out.error) || 'Could not fill that field');
    }
  };
  btn.addEventListener('click', accept);
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'btn btn-ghost review-skip';
  skip.textContent = 'Leave blank';
  skip.title = 'Do not fill this field next time';
  skip.addEventListener('click', async () => {
    skip.disabled = true;
    btn.disabled = true;
    setDisabled(true);
    acceptDrafts.delete(draftKey);
    if (acceptFocusKey === draftKey) acceptFocusKey = '';
    const out = await window.magnetChrome.reviewAccept(actionJobId(job), f.id, '', f.steps, f.label, {
      skip: true,
      classId: 'skip',
    });
    if (!out || !out.ok) {
      skip.disabled = false;
      btn.disabled = false;
      setDisabled(false);
      toast((out && out.error) || 'Could not skip that field');
    }
  });
  if (control.isText) {
    val.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        accept();
      }
    });
  }
  if (acceptFocusKey === draftKey) {
    requestAnimationFrame(() => {
      const focusEl = val.matches && val.matches('input, textarea, select') ? val : val.querySelector('input, textarea, select');
      if (!focusEl) return;
      focusEl.focus();
      if (control.isText && typeof focusEl.setSelectionRange === 'function') {
        const start = Math.min(acceptCaret, focusEl.value.length);
        const end = Math.min(acceptSelEnd || start, focusEl.value.length);
        try {
          focusEl.setSelectionRange(start, end);
        } catch (_) {}
      }
    });
  }
  actions.append(btn, skip, renderRecordButton(job, f.id));
  renderReviewLevers(job, f, {
    host: actions,
    getValue: readValue,
    onBusy: (on) => {
      btn.disabled = on;
      skip.disabled = on;
      setDisabled(on);
    },
    writeLabel: 'Retry write',
    writeTitle: 'Write this answer again with the selected strategy',
  });
  row.append(meta, actions);
  return row;
}

function renderStrategyCard(job, f) {
  const rec = job.fillRecord && job.fillRecord.fieldId === f.id ? job.fillRecord : null;
  const steps = (rec && rec.steps && rec.steps.length ? rec.steps : f.steps) || [];
  const status = rec && rec.status;
  const recording = status === 'recording';
  const verifying = status === 'verifying';
  const verified = status === 'verified';
  const field = fieldForFill(job, f);
  const family = (field && field.shape && field.shape.family) || '';
  const extra = {
    recording,
    verifying,
    verified,
    failed: status === 'failed',
    decoy: rec && rec.decoy,
    proved: rec && rec.proved,
    error: rec && rec.error,
    family,
  };
  const row = document.createElement('div');
  row.className =
    'review-row review-strategy review-field review-kind-couldnt-fill' +
    (job.reviewFocus === f.id || job.focusedFieldId === f.id || recording ? ' is-focus' : '') +
    (job.reviewFlashId === f.id ? ' is-flash' : '') +
    (recording ? ' is-recording' : '');
  row.dataset.fieldId = f.id;
  if (job.reviewFlashId === f.id) {
    requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }));
  }
  const meta = document.createElement('div');
  meta.className = 'review-meta';
  const head = document.createElement('div');
  head.className = 'review-head';
  const kind = document.createElement('div');
  kind.className = 'review-kind';
  kind.textContent = cardKind(f, extra);
  head.append(kind, renderFocusButton(row, job, f.id));
  const lab = document.createElement('div');
  lab.className = 'review-label';
  lab.textContent = f.label || f.id;
  const intended = document.createElement('div');
  intended.className = 'review-intended';
  intended.textContent = 'Intended · ' + (f.value || '');
  const why = document.createElement('div');
  why.className = 'review-why';
  why.textContent = cardWhy(f, extra);
  meta.append(head, lab, intended);
  if (steps.length) {
    const list = document.createElement('ol');
    list.className = 'review-steps';
    for (const step of steps) {
      const li = document.createElement('li');
      li.textContent = formatReviewStep(step);
      list.appendChild(li);
    }
    meta.appendChild(list);
  }
  meta.appendChild(why);
  const pipe = renderReviewPipeline(job, f);
  if (pipe) meta.appendChild(pipe);
  attachFieldChat(job, f.id, meta);
  const actions = document.createElement('div');
  actions.className = 'review-actions';
  const learn = document.createElement('button');
  learn.type = 'button';
  learn.className = 'btn btn-primary review-accept';
  if (verified) {
    learn.textContent = 'Confirm';
    learn.title = 'Save these steps for the next posting';
  } else {
    learn.textContent = 'Learn these steps';
    learn.title = 'Replay these steps (decoy, then intended) and save if they land';
  }
  const recBtn = renderRecordButton(job, f.id);
  learn.disabled = verifying || recording || (!verified && !steps.length);
  recBtn.disabled = recBtn.disabled || verifying;
  learn.addEventListener('click', async () => {
    learn.disabled = true;
    recBtn.disabled = true;
    const out = verified
      ? await window.magnetChrome.reviewRecordConfirm(actionJobId(job), f.id)
      : await window.magnetChrome.reviewLearnSteps(actionJobId(job), f.id, steps, f.value);
    if (!out || !out.ok) {
      learn.disabled = false;
      recBtn.disabled = false;
      toast((out && out.error) || 'Could not prove those steps');
    }
  });
  actions.append(learn, recBtn);
  renderReviewLevers(job, f, {
    host: actions,
    getValue: () => f.value || (field && field.intended) || '',
    onBusy: (on) => {
      learn.disabled = on || verifying || recording || (!verified && !steps.length);
      recBtn.disabled = verifying || on;
    },
    writeLabel: 'Retry write',
    writeTitle: 'Write the intended value again with the selected strategy',
  });
  row.append(meta, actions);
  return row;
}

function renderRecipeCard(job, recipe) {
  const row = document.createElement('div');
  row.className = 'review-row review-recipe';
  const meta = document.createElement('div');
  meta.className = 'review-meta';
  const kind = document.createElement('div');
  kind.className = 'review-kind';
  kind.textContent = 'Learn this fill recipe';
  const lab = document.createElement('div');
  lab.className = 'review-label';
  lab.textContent = recipe.label || recipe.field_id || recipe.id;
  const draftKey = `${job.id}:recipe:${recipe.id}`;
  const field = reviewFieldOf(job, { id: recipe.field_id || recipe.id });
  const current = acceptDrafts.has(draftKey) ? acceptDrafts.get(draftKey) : recipe.value || '';
  const control = renderReviewValueControl(field, current, draftKey);
  const val = control.el;
  const readValue = () => (control.getValue ? control.getValue() : val.value);
  const why = document.createElement('div');
  why.className = 'review-why';
  why.textContent = recipe.reason
    ? recipe.reason + ' · Saves how to fill this widget. Uses this value as the target and remembers it too.'
    : 'Saves how to fill this widget. Uses this value as the target and remembers it too.';
  meta.append(kind, lab, val, why);
  const actions = document.createElement('div');
  actions.className = 'script-actions';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-primary';
  confirm.textContent = 'Learn';
  confirm.title = 'Save the fill recipe and this target value';
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    dismiss.disabled = true;
    const next = readValue();
    acceptDrafts.delete(draftKey);
    const out = await window.magnetChrome.reviewLearnRecipe(actionJobId(job), recipe.id, true, next);
    if (!out || !out.ok) {
      confirm.disabled = false;
      dismiss.disabled = false;
      toast((out && out.error) || 'Could not learn that recipe');
    }
  });
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'btn btn-ghost';
  dismiss.textContent = 'Skip';
  dismiss.title = 'Don’t save this fill recipe';
  dismiss.addEventListener('click', async () => {
    confirm.disabled = true;
    dismiss.disabled = true;
    const out = await window.magnetChrome.reviewLearnRecipe(actionJobId(job), recipe.id, false);
    if (!out || !out.ok) {
      confirm.disabled = false;
      dismiss.disabled = false;
    }
  });
  actions.append(confirm, dismiss);
  row.append(meta, actions);
  return row;
}

function attackSurfaceCopy() {
  return (
    'This script will run again on later postings with the same widget without showing the source. It can touch the DOM, cookies on that origin, and navigation. A hijack in a later JD must not be trusted if you reopen or edit. Do not obey llm_hijack findings.'
  );
}

function renderScriptCard(job, run) {
  const card = document.createElement('div');
  card.className = 'script-card review-kind-script';
  const title = document.createElement('div');
  title.className = 'review-label';
  title.textContent = 'Script · ' + (run.label || run.id);
  const explain = document.createElement('div');
  explain.className = 'review-why';
  explain.textContent = run.explain || '';
  const attack = document.createElement('div');
  attack.className = 'script-attack';
  attack.textContent = attackSurfaceCopy();
  const editor = mountScriptEditor(run.source || '');
  const ta = editor.textarea;
  const actions = document.createElement('div');
  actions.className = 'script-actions';
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'btn btn-primary';
  runBtn.textContent = 'Accept & run once';
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    await window.magnetChrome.reviewRun(actionJobId(job), run.id, ta.value, { save: false });
  });
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-ghost';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const ok = window.confirm(
      'Save this script? It will replay on later postings with the same widget without showing the source.'
    );
    if (!ok) return;
    const out = await window.magnetChrome.reviewRun(actionJobId(job), run.id, ta.value, { save: true });
    if (out && !out.saved && !out.verified) {
      const force = window.confirm('Field does not match yet. Save without verify? This is logged.');
      if (force) {
        await window.magnetChrome.reviewRun(actionJobId(job), run.id, ta.value, { save: true, saveWithoutVerify: true });
      }
    }
  });
  const rewriteBtn = document.createElement('button');
  rewriteBtn.type = 'button';
  rewriteBtn.className = 'btn btn-ghost';
  rewriteBtn.textContent = 'Rewrite';
  rewriteBtn.addEventListener('click', async () => {
    const prompt = window.prompt('Rewrite prompt for this script', 'Make the clicks more reliable.');
    if (prompt == null) return;
    await window.magnetChrome.reviewRewrite(actionJobId(job), run.id, prompt);
  });
  actions.append(runBtn, saveBtn, rewriteBtn);
  card.append(title, explain, attack, editor.wrap, actions);
  return card;
}

function mountScriptEditor(source) {
  const wrap = document.createElement('div');
  wrap.className = 'script-editor';
  const hi = document.createElement('pre');
  hi.className = 'script-highlight';
  hi.setAttribute('aria-hidden', 'true');
  const ta = document.createElement('textarea');
  ta.className = 'script-source';
  ta.rows = 8;
  ta.spellcheck = false;
  ta.wrap = 'off';
  ta.setAttribute('aria-label', 'Eval script source');
  ta.value = source || '';
  const paint = () => {
    const html =
      window.JsHighlight && window.JsHighlight.toHtml
        ? window.JsHighlight.toHtml(ta.value)
        : window.JsHighlight && window.JsHighlight.escapeHtml
          ? window.JsHighlight.escapeHtml(ta.value)
          : ta.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    hi.innerHTML = html + '\n';
  };
  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', () => {
    hi.scrollTop = ta.scrollTop;
    hi.scrollLeft = ta.scrollLeft;
  });
  paint();
  wrap.append(hi, ta);
  return { wrap, textarea: ta };
}

function hexSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  return svg;
}

function requestChatCancel(jobId, draft) {
  if (!jobId || !window.magnetChrome) return;
  const key = composeKey();
  if (cancellingTabs.has(jobId) || cancellingTabs.has(key)) return;
  cancellingTabs.add(jobId);
  cancellingTabs.add(key);
  if (current && current.id === jobId) current.chatStream = null;
  if (key === INGEST_KEY && current) current.ingestBusy = false;
  refreshChatForKey(jobId);
  refreshChatForKey(key);
  if (draft && window.magnetChrome.chatDraftCancel) window.magnetChrome.chatDraftCancel(jobId);
  else if (window.magnetChrome.chatCancel) window.magnetChrome.chatCancel(jobId);
}

function hexCancelButton(onClick, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-hex-x';
  btn.title = label || 'Cancel';
  btn.setAttribute('aria-label', label || 'Cancel');
  btn.appendChild(hexSvg());
  btn.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function fieldContextRow(job) {
  const conv = conversationOf(job);
  if (conv && !conv.applyMatches) return null;
  const teach = job && job.teachPending;
  const ask = teach && teach.kind === 'ask' ? teach : null;
  const target = job && job.chatTarget;
  const row = ask || target;
  const label = (row && row.label) || '';
  if (!label) return null;
  return { ...row, label };
}

function renderChatTarget(job) {
  if (!chatTargetEl || !chatTargetLabel) return;
  const row = fieldContextRow(job);
  if (!row) {
    chatTargetEl.hidden = true;
    chatTargetLabel.textContent = '';
    return;
  }
  chatTargetLabel.textContent = row.label;
  chatTargetEl.hidden = false;
}

function renderChat(job) {
  const ingest = isIngestConversation(job);
  const key = conversationComposeKey(job);
  paintChatLog(chatLog, (job && job.chat) || [], {
    empty: ingest
      ? 'Describe the search — LinkedIn plus ATS boards, age, keywords, pay — or paste apply URLs. Magnet compiles a plan; you hit Go, sign in once if asked, and it hunts until it has enough new matches.'
      : 'Chat stays with this job. Name another company to reuse a draft, or say “use what I wrote.” Magnet will prefer answers you typed yourself.',
    key,
    scope: ingest ? 'ingest' : 'job',
    jobId: ingest ? INGEST_KEY : conversationJobId(job) || (job && job.id),
    busy: Boolean(
      job &&
        !cancellingTabs.has(key) &&
        (inFlightTabs.has(key) || job.ingestBusy || (job.chatStream && (job.chatStream.stage || job.chatStream.text)))
    ),
    stream: job && job.chatStream,
    folded: job && job.chatFolded,
    fieldContext: fieldContextRow(job),
  });
  renderChatTarget(job);
  syncChatForm();
}

function makeTypingWait(opts = {}) {
  const wait = document.createElement('div');
  wait.className = 'chat-msg chat-msg-magnet chat-msg-wait';
  const body = document.createElement('div');
  body.className = 'chat-bubble chat-bubble-wait';
  body.setAttribute('role', 'status');
  body.setAttribute('aria-live', 'polite');
  body.setAttribute('aria-label', opts.stage || 'Magnet is typing');
  const dots = document.createElement('span');
  dots.className = 'chat-typing';
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('span'));
  body.appendChild(dots);
  if (opts.stage) {
    const stage = document.createElement('span');
    stage.className = 'chat-wait-stage';
    stage.textContent = opts.stage;
    body.appendChild(stage);
  }
  wait.appendChild(body);
  if (opts.jobId && window.magnetChrome && window.magnetChrome.chatCancel) {
    wait.appendChild(hexCancelButton(() => requestChatCancel(opts.jobId), 'Cancel'));
  }
  return wait;
}

function parseChatAt(at) {
  if (at == null || at === '') return null;
  const d = new Date(typeof at === 'number' ? at : Number(at) || at);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatChatTime(at) {
  const d = parseChatAt(at);
  if (!d) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameYear) return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function attachChatTime(row, at) {
  const d = parseChatAt(at);
  const label = formatChatTime(at);
  if (!d || !label) return;
  const stamp = document.createElement('time');
  stamp.className = 'chat-time';
  stamp.dateTime = d.toISOString();
  stamp.title = d.toLocaleString();
  stamp.textContent = label;
  row.appendChild(stamp);
}

function attachContextFold(logEl, folded, opts) {
  if (!folded || !folded.length) return;
  const details = document.createElement('details');
  details.className = 'chat-fold chat-fold-context';
  const summary = document.createElement('summary');
  summary.textContent = `${folded.length} older turn${folded.length === 1 ? '' : 's'} hidden`;
  const why = document.createElement('div');
  why.className = 'chat-rot-why';
  why.textContent =
    'Oldest turns were dropped so the next send stays under half the model window. Apply chats should not need more.';
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'btn btn-ghost';
  expand.textContent = 'Expand';
  expand.addEventListener('click', (e) => {
    e.preventDefault();
    if (opts.jobId && window.magnetChrome && window.magnetChrome.chatExpand) {
      window.magnetChrome.chatExpand(opts.jobId);
    }
  });
  details.append(summary, why, expand);
  logEl.appendChild(details);
}

function attachDraftBubble(logEl, draft, opts) {
  const row = document.createElement('div');
  row.className = 'chat-msg chat-msg-magnet chat-msg-draft';
  const body = document.createElement('div');
  body.className = 'chat-bubble chat-bubble-draft';
  const head = document.createElement('div');
  head.className = 'chat-draft-head';
  const lab = document.createElement('span');
  lab.textContent = draft.label || draft.id || 'draft';
  head.appendChild(lab);
  if (draft.reviewing && opts.jobId && window.magnetChrome && window.magnetChrome.chatDraftCancel) {
    head.appendChild(hexCancelButton(() => requestChatCancel(opts.jobId, true), 'Cancel review'));
  }
  head.appendChild(chatCopyButton(draft.text));
  const tx = document.createElement('div');
  tx.className = 'chat-bubble-text';
  tx.textContent = unescapeCopyText(draft.text);
  body.append(head, tx);
  row.appendChild(body);
  logEl.appendChild(row);
}

function attachMailCard(row, msg) {
  const card = document.createElement('div');
  card.className = 'mail-card';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn btn-ghost';
  open.textContent = 'Open email';
  open.addEventListener('click', () => {
    if (window.magnetChrome && window.magnetChrome.openMail) window.magnetChrome.openMail(msg.href);
  });
  card.appendChild(open);
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'btn btn-ghost';
  skip.textContent = 'Not a reject';
  skip.addEventListener('click', () => {
    if (window.magnetChrome && window.magnetChrome.resolveMail) window.magnetChrome.resolveMail(msg.mailId, 'no');
  });
  card.appendChild(skip);
  for (const c of (msg.candidates || []).slice(0, 4)) {
    if (!c || !c.url) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost';
    btn.textContent = `Reject ${c.company || c.title || 'this job'}`;
    btn.addEventListener('click', () => {
      if (window.magnetChrome && window.magnetChrome.resolveMail) window.magnetChrome.resolveMail(msg.mailId, c.url);
    });
    card.appendChild(btn);
  }
  row.appendChild(card);
}

function paintChatLog(logEl, msgs, opts) {
  if (!logEl) return;
  const stick = logEl.scrollHeight - logEl.scrollTop < logEl.clientHeight + 48;
  logEl.replaceChildren();
  attachContextFold(logEl, opts.folded, opts);
  if (!msgs.length && !opts.busy && !(opts.stream && opts.stream.text)) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = opts.empty || '';
    logEl.appendChild(empty);
  }
  for (const [i, m] of msgs.entries()) {
    const row = document.createElement('div');
    row.className = 'chat-msg chat-msg-' + (m.role === 'you' ? 'you' : 'magnet');
    if (m.kind === 'alert') row.classList.add('chat-msg-alert');
    if (m.kind === 'mail') row.classList.add('chat-msg-mail');
    if (m.text) {
      const body = document.createElement('div');
      body.className = 'chat-bubble';
      fillChatBubble(body, m.text);
      row.appendChild(body);
    }
    if (m.kind === 'mail') attachMailCard(row, m);
    attachChatTime(row, m.at);
    for (const [j, fold] of (m.folds || []).entries()) {
      if (!fold || !fold.text) continue;
      attachNoticeFold(row, `${opts.key}:${i}:fold:${j}`, fold);
    }
    for (const [j, t] of (m.tools || []).entries()) {
      attachToolFold(row, `${opts.key}:${i}:tool:${j}`, t);
    }
    if (m.sent) attachDataFold(row, `${opts.key}:${i}:sent`, 'sent', m.sent);
    const receivedOnlyError = Boolean(
      m.received && m.received.error && Object.keys(m.received).every((k) => k === 'error' || m.received[k] == null)
    );
    if (m.received && !receivedOnlyError) attachDataFold(row, `${opts.key}:${i}:received`, 'received', m.received);
    const openAsks = (m.asks || []).filter((a) => a && a.prompt && !a.answered);
    const laterAsk = msgs.slice(i + 1).some((n) => (n.asks || []).some((a) => a && a.prompt && !a.answered));
    if (openAsks.length && !laterAsk) {
      attachAskCard(row, openAsks, opts);
    }
    logEl.appendChild(row);
    for (const [j, d] of (m.drafts || []).entries()) {
      if (!d || !d.text) continue;
      attachDraftBubble(logEl, d, opts);
    }
  }
  const stream = opts.stream;
  if (stream && stream.text) {
    const row = document.createElement('div');
    row.className = 'chat-msg chat-msg-magnet chat-msg-stream';
    const body = document.createElement('div');
    body.className = 'chat-bubble';
    fillChatBubble(body, stream.text);
    row.appendChild(body);
    if (opts.jobId && window.magnetChrome && window.magnetChrome.chatCancel) {
      row.appendChild(hexCancelButton(() => requestChatCancel(opts.jobId), 'Cancel'));
    }
    logEl.appendChild(row);
    for (const d of stream.drafts || []) {
      if (d && d.text) attachDraftBubble(logEl, { ...d, reviewing: stream.reviewing }, opts);
    }
  } else if (opts.busy) {
    logEl.appendChild(makeTypingWait({ jobId: opts.jobId, stage: stream && stream.stage }));
  }
  attachFieldContext(logEl, opts.fieldContext);
  if (stick) logEl.scrollTop = logEl.scrollHeight;
}

function attachFieldContext(logEl, row) {
  if (!logEl || !row || !row.label) return;
  const bar = document.createElement('div');
  bar.className = 'chat-field-context';
  const mark = document.createElement('span');
  mark.className = 'chat-field-context-mark';
  mark.textContent = 'this question';
  const lab = document.createElement('span');
  lab.className = 'chat-field-context-label';
  lab.textContent = row.label;
  bar.append(mark, lab);
  logEl.appendChild(bar);
}

function toolLabel(t) {
  const name = String((t && t.name) || 'tool');
  const args = (t && t.args) || {};
  const hint = args.query || args.url || args.text || args.prompt || '';
  return hint ? `${name} · ${String(hint).slice(0, 72)}` : name;
}

function attachToolFold(row, key, tool) {
  attachDataFold(row, key, toolLabel(tool), {
    name: tool.name,
    args: tool.args,
    result: tool.result,
  });
}

function attachAskCard(row, asks, opts) {
  const card = document.createElement('div');
  card.className = 'ask-card';
  const selected = new Map();
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn btn-primary ask-submit';
  submit.textContent = 'Answer';
  const sync = () => {
    submit.disabled = asks.every((q) => {
      const cur = selected.get(q.id);
      return !cur || (Array.isArray(cur) ? !cur.length : !String(cur).trim());
    });
  };
  for (const q of asks) {
    const block = document.createElement('div');
    block.className = 'ask-q';
    const prompt = document.createElement('div');
    prompt.className = 'ask-prompt';
    prompt.textContent = q.prompt;
    block.appendChild(prompt);
    if (q.why) {
      const why = document.createElement('div');
      why.className = 'ask-why';
      why.textContent = q.why;
      block.appendChild(why);
    }
    if (q.kind === 'story-confirm') {
      const emp = document.createElement('input');
      emp.type = 'text';
      emp.className = 'ask-employer';
      emp.placeholder = 'Employer';
      emp.value = (q.story && q.story.employer) || '';
      emp.addEventListener('input', () => {
        q._employer = emp.value;
      });
      q._employer = emp.value;
      block.appendChild(emp);
    }
    if (q.options && q.options.length) {
      const optsRow = document.createElement('div');
      optsRow.className = 'ask-options';
      for (const opt of q.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ask-opt';
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          if (q.allow_multiple) {
            const cur = selected.get(q.id) || [];
            const i = cur.indexOf(opt.label);
            if (i >= 0) cur.splice(i, 1);
            else cur.push(opt.label);
            selected.set(q.id, cur);
            btn.classList.toggle('is-on', i < 0);
          } else {
            selected.set(q.id, opt.label);
            optsRow.querySelectorAll('.ask-opt').forEach((b) => b.classList.remove('is-on'));
            btn.classList.add('is-on');
          }
          sync();
        });
        optsRow.appendChild(btn);
      }
      block.appendChild(optsRow);
    } else {
      const input = document.createElement('textarea');
      input.className = 'ask-free';
      input.rows = 2;
      input.placeholder = 'Your answer';
      input.addEventListener('input', () => {
        selected.set(q.id, input.value);
        sync();
      });
      block.appendChild(input);
    }
    card.appendChild(block);
  }
  submit.addEventListener('click', async () => {
    const answers = {};
    for (const q of asks) {
      const choice = selected.get(q.id);
      answers[q.id] =
        q.kind === 'story-confirm' ? { choice, employer: q._employer || (q.story && q.story.employer) || '' } : choice;
    }
    submit.disabled = true;
    if (opts.scope === 'ingest' && window.magnetChrome.ingestAnswer) {
      await window.magnetChrome.ingestAnswer(asks, answers);
    } else if (opts.jobId) await window.magnetChrome.chatAnswer(opts.jobId, asks, answers);
  });
  sync();
  card.appendChild(submit);
  row.appendChild(card);
}

function syncChatForm() {
  const ingest = isIngestConversation();
  const show = ingest || railTab === 'chat';
  if (chatForm) chatForm.hidden = !show;
  if (railCompose) railCompose.classList.toggle('is-compose-open', show);
  renderChatQueue();
  if (!show || !chatInput || !chatSend) return;
  chatInput.placeholder = ingest ? INGEST_PLACEHOLDER : CHAT_PLACEHOLDER;
  chatInput.disabled = false;
  chatSend.disabled = ingest ? false : !(conversationJobId() || (conversationOf() && conversationOf().key));
}

function formatTrace(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  const { prompt, raw, payload, ...rest } = data;
  const parts = [];
  if (payload) parts.push(JSON.stringify(payload, null, 2));
  const restKeys = Object.keys(rest).filter((k) => rest[k] != null && rest[k] !== '');
  if (restKeys.length) {
    const slim = {};
    for (const k of restKeys) slim[k] = rest[k];
    parts.push(JSON.stringify(slim, null, 2));
  }
  if (prompt) parts.push('--- prompt ---\n' + String(prompt));
  if (raw) parts.push('--- raw ---\n' + (typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)));
  return parts.join('\n\n') || JSON.stringify(data, null, 2);
}

function attachNoticeFold(row, key, fold) {
  const level = fold.level === 'error' ? 'error' : 'warn';
  const shutKey = key + ':shut';
  const details = document.createElement('details');
  details.className = 'chat-fold chat-fold-' + level;
  details.open = !openFolds.has(shutKey);
  const summary = document.createElement('summary');
  summary.textContent = fold.label || (level === 'error' ? 'error' : 'warning');
  details.appendChild(summary);
  const fill = () => {
    if (details.querySelector('.chat-fold-data')) return;
    const pre = document.createElement('pre');
    pre.className = 'chat-fold-data';
    pre.textContent = fold.text;
    details.appendChild(pre);
  };
  details.addEventListener('toggle', () => {
    if (details.open) {
      openFolds.delete(shutKey);
      fill();
    } else {
      openFolds.add(shutKey);
    }
  });
  if (details.open) fill();
  row.appendChild(details);
}

function attachDataFold(row, key, label, data) {
  const details = document.createElement('details');
  details.className = 'chat-fold';
  details.open = openFolds.has(key);
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.appendChild(summary);
  const fill = () => {
    if (details.querySelector('.chat-fold-data')) return;
    const pre = document.createElement('pre');
    pre.className = 'chat-fold-data';
    pre.textContent = formatTrace(data);
    details.appendChild(pre);
  };
  details.addEventListener('toggle', () => {
    if (details.open) {
      openFolds.add(key);
      fill();
    } else {
      openFolds.delete(key);
    }
  });
  if (details.open) fill();
  row.appendChild(details);
}

function attachDraftFold(row, key, draft) {
  const details = document.createElement('details');
  details.className = 'chat-fold chat-fold-draft';
  details.open = openFolds.has(key);
  const summary = document.createElement('summary');
  const lab = document.createElement('span');
  lab.className = 'chat-fold-label';
  lab.textContent = 'draft · ' + (draft.label || draft.id || 'field');
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'chat-copy';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    copyText(unescapeCopyText(draft.text))
      .then(() => {
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 1200);
      })
      .catch(() => {});
  });
  copyBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  summary.append(lab, copyBtn);
  const tx = document.createElement('div');
  tx.className = 'chat-draft-text';
  tx.textContent = draft.text;
  details.append(summary, tx);
  details.addEventListener('toggle', () => {
    if (details.open) openFolds.add(key);
    else openFolds.delete(key);
  });
  row.appendChild(details);
}

function unescapeCopyText(text) {
  const s = String(text || '');
  if (s.includes('\\n') && !s.includes('\n')) return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  return s;
}

function chatCopyButton(text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-copy';
  btn.textContent = 'Copy';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    copyText(unescapeCopyText(text))
      .then(() => {
        btn.textContent = 'Copied';
        setTimeout(() => {
          btn.textContent = 'Copy';
        }, 1200);
      })
      .catch(() => {});
  });
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  return btn;
}

function fillChatBubble(body, text) {
  const tx = document.createElement('div');
  tx.className = 'chat-bubble-text';
  tx.textContent = unescapeCopyText(text);
  body.append(tx, chatCopyButton(text));
}

function copyText(text) {
  const value = String(text || '');
  if (window.magnetChrome && window.magnetChrome.clipboardWrite) {
    return window.magnetChrome.clipboardWrite(value);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(value);
  }
  return Promise.resolve();
}

function renderPostingUrl(url) {
  postingEl.replaceChildren();
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.textContent = url;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.magnetChrome) window.magnetChrome.openJdPage();
  });
  postingEl.appendChild(a);
}

function renderJdBody(text) {
  jdText.replaceChildren();
  const raw = (text || '').trim();
  if (!raw) {
    jdText.classList.add('is-empty');
    jdText.textContent = '(no JD yet — ingest captures this)';
    return;
  }
  const parse = window.JdFormat && window.JdFormat.parseJdBlocks;
  const blocks = parse ? parse(raw) : [{ type: 'p', text: raw }];
  if (!blocks.length) {
    jdText.classList.add('is-empty');
    jdText.textContent = raw;
    return;
  }
  jdText.classList.remove('is-empty');
  for (const b of blocks) {
    if (b.type === 'h') {
      const h = document.createElement('h3');
      h.textContent = b.text;
      jdText.appendChild(h);
    } else if (b.type === 'ul') {
      const ul = document.createElement('ul');
      for (const item of b.items) {
        const li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      }
      jdText.appendChild(ul);
    } else {
      const p = document.createElement('p');
      p.textContent = b.text;
      jdText.appendChild(p);
    }
  }
}

function hideToast() {
  clearTimeout(toast.timer);
  toast.undoArmed = false;
  if (!toastEl) return;
  toastEl.hidden = true;
  toastEl.classList.remove('is-undo', 'is-pass', 'is-rejected', 'is-complete');
  if (toastUndo) toastUndo.hidden = true;
  if (toastBar) toastBar.style.animationDuration = '';
}

function toast(msg, opts) {
  const payload = msg && typeof msg === 'object' ? msg : { message: msg, ...(opts || {}) };
  if (payload.hide) {
    hideToast();
    return;
  }
  if (toast.undoArmed && !payload.undo) return;
  const text = payload.message || '';
  if (!toastEl) return;
  clearTimeout(toast.timer);
  toast.undoArmed = Boolean(payload.undo);
  toastEl.hidden = false;
  toastEl.classList.toggle('is-undo', Boolean(payload.undo));
  toastEl.classList.toggle('is-complete', payload.kind === 'complete');
  toastEl.classList.toggle('is-pass', payload.kind === 'pass');
  toastEl.classList.toggle('is-rejected', payload.kind === 'rejected');
  if (toastMsg) toastMsg.textContent = text;
  else toastEl.textContent = text;
  if (toastUndo) toastUndo.hidden = !payload.undo;
  const hold = payload.holdMs
    || (/matching experience|thinking|planning|reviewing leftovers|reviewing draft|drafting essays/i.test(text) ? 12000 : 3200);
  if (toastBar) {
    toastBar.style.animation = 'none';
    void toastBar.offsetWidth;
    toastBar.style.animation = '';
    toastBar.style.animationDuration = `${hold}ms`;
  }
  toast.timer = setTimeout(hideToast, hold);
}

if (window.magnetChrome) {
  window.magnetChrome.onUpdate(render);
  window.magnetChrome.getActive().then(render).catch(console.error);
  window.magnetChrome.onToast((p) => toast(p || {}));
  if (toastUndo) {
    toastUndo.addEventListener('click', () => {
      if (!window.magnetChrome.undoOutcome) return;
      window.magnetChrome.undoOutcome().catch(console.error);
    });
  }
  const huntOk = document.getElementById('hunt-login-ok');
  const huntSkip = document.getElementById('hunt-login-skip');
  if (huntOk) {
    huntOk.addEventListener('click', () => {
      if (window.magnetChrome.huntLogin) window.magnetChrome.huntLogin('in').catch(console.error);
    });
  }
  if (huntSkip) {
    huntSkip.addEventListener('click', () => {
      if (window.magnetChrome.huntLogin) window.magnetChrome.huntLogin('skip').catch(console.error);
    });
  }
  if (window.magnetChrome.onChatDelta) {
    window.magnetChrome.onChatDelta((p) => {
      if (!p || !current) return;
      const conv = conversationOf(current);
      if (p.id !== (conv && conv.jobId) && p.key !== (conv && conv.key) && p.id !== current.id) return;
      current.chatStream = p.stream || null;
      if (isIngestConversation() || railTab === 'chat') renderChat(current);
    });
  }
  if (chatTargetClear) {
    if (!chatTargetClear.childElementCount) chatTargetClear.appendChild(hexSvg());
    chatTargetClear.addEventListener('click', () => {
      if (current && window.magnetChrome.chatTargetClear) window.magnetChrome.chatTargetClear(current.id);
    });
  }
  if (isDrawerShell) {
    document.addEventListener('pointerdown', unlockAttentionSound, { once: true });
    if (window.magnetChrome.onAttentionSound) {
      window.magnetChrome.onAttentionSound(playAttentionSound);
    }
  }
  function setStagesOpen(open) {
    stagesOpen = Boolean(open);
    if (autofillStagesEl) autofillStagesEl.hidden = !stagesOpen;
    if (autofillMenuEl) {
      autofillMenuEl.classList.toggle('is-open', stagesOpen);
      autofillMenuEl.setAttribute('aria-expanded', String(stagesOpen));
    }
  }

  async function runStage(stage) {
    if (!current || !current.id) return;
    if (stage === 'jd') {
      applyRailTab('jd');
      if (window.magnetChrome.setDrawer) window.magnetChrome.setDrawer('jd');
      return window.magnetChrome.jd(current.id);
    }
    if (stage === 'resume') return window.magnetChrome.uploadResume(current.id);
    if (stage === 'fill') return window.magnetChrome.fill(current.id);
    if (stage === 'essay') return window.magnetChrome.essays(current.id);
  }

  if (autofillEl) {
    autofillEl.addEventListener('click', () => {
      if (!current) return;
      if (current.autofillStatus === 'running') {
        if (window.magnetChrome.cancel) window.magnetChrome.cancel(current.id);
        return;
      }
      window.magnetChrome.autofill(current.id);
    });
  }
  if (autofillMenuEl) {
    autofillMenuEl.addEventListener('click', (e) => {
      e.stopPropagation();
      setStagesOpen(!stagesOpen);
    });
  }
  if (autofillStagesEl) {
    autofillStagesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-stage]');
      if (!btn || !current) return;
      setStagesOpen(false);
      runStage(btn.dataset.stage).catch(console.error);
    });
  }
  document.addEventListener('click', (e) => {
    if (!stagesOpen) return;
    if (e.target.closest && e.target.closest('#autofill-split, #autofill-stages')) return;
    setStagesOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stagesOpen) setStagesOpen(false);
  });
  if (completeEl) completeEl.addEventListener('click', () => current && window.magnetChrome.complete(current.id));
  if (passEl) passEl.addEventListener('click', () => current && window.magnetChrome.pass(current.id));
  if (surfaceSwitch) {
    surfaceSwitch.addEventListener('click', () => {
      if (!current) return;
      if (current.mode !== 'ats') window.magnetChrome.openPosting();
      else window.magnetChrome.showDashboard();
    });
  }
  resumeChip.addEventListener('click', () => {
    if (!current || !current.resumes) return;
    const ids = current.resumes.map((r) => r.id);
    const i = ids.indexOf(current.resume && current.resume.id);
    const next = ids[(i + 1) % ids.length];
    window.magnetChrome.pickResume(current.id, next);
  });
  document.getElementById('jd-clipboard').addEventListener('click', () => {
    if (current) window.magnetChrome.clipboardJd(actionJobId(current) || current.id);
  });
  document.getElementById('jd-open-page').addEventListener('click', () => window.magnetChrome.openJdPage());
  window.magnetChrome.onFindOpen(() => {
    findBar.hidden = false;
    findInput.focus();
    findInput.select();
  });
  if (window.magnetChrome.onFindFocus) {
    window.magnetChrome.onFindFocus(() => {
      if (findBar.hidden) return;
      findInput.focus();
    });
  }
  window.magnetChrome.onFindClose(() => {
    findBar.hidden = true;
  });
  window.magnetChrome.onFindResult((r) => {
    findCount.textContent = r && r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : '';
  });
  let findTimer = 0;
  findInput.addEventListener('input', () => {
    findQuery = findInput.value;
    clearTimeout(findTimer);
    findTimer = setTimeout(() => {
      window.magnetChrome.findQuery(findQuery, { findNext: false });
    }, 120);
  });
  findInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
  });
  findBar.addEventListener('submit', (e) => {
    e.preventDefault();
    window.magnetChrome.findQuery(findQuery, { findNext: true, forward: true });
  });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      window.magnetChrome.findQuery(findQuery, { findNext: true, forward: !e.shiftKey });
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      window.magnetChrome.findClose();
    }
  });
  document.getElementById('find-next').addEventListener('click', () =>
    window.magnetChrome.findQuery(findQuery, { findNext: true, forward: true })
  );
  document.getElementById('find-prev').addEventListener('click', () =>
    window.magnetChrome.findQuery(findQuery, { findNext: true, forward: false })
  );
  document.getElementById('find-close').addEventListener('click', () => window.magnetChrome.findClose());
  if (window.magnetChrome.onDrawerMode) window.magnetChrome.onDrawerMode(applyRailTab);
  if (window.magnetChrome.onFlagging) {
    window.magnetChrome.onFlagging((on) => document.body.classList.toggle('is-flagging', Boolean(on)));
  }
  document.querySelectorAll('.rail-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyRailTab(btn.dataset.tab);
      if (window.magnetChrome.setDrawer) window.magnetChrome.setDrawer(btn.dataset.tab);
    });
  });
  if (railTabsToggle) {
    railTabsToggle.addEventListener('click', () => {
      tabsCollapsed = !tabsCollapsed;
      try {
        sessionStorage.setItem('magnet.railTabsCollapsed', tabsCollapsed ? '1' : '0');
      } catch (_) {}
      applyTabsCollapsed();
    });
  }
  if (metaToggle) {
    metaToggle.addEventListener('click', () => {
      metaCollapsed = !metaCollapsed;
      try {
        sessionStorage.setItem('magnet.metaCollapsed', metaCollapsed ? '1' : '0');
      } catch (_) {}
      applyMetaCollapsed();
    });
  }
  if (isDockShell) {
    document.querySelectorAll('.shell-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.magnetChrome.setShellPane) window.magnetChrome.setShellPane(btn.dataset.pane);
      });
    });
    if (window.magnetChrome.onShellPane) {
      window.magnetChrome.onShellPane((p) => applyShellPane(p && p.pane));
    }
    if (window.magnetChrome.getShellPane) {
      window.magnetChrome.getShellPane()
        .then((p) => applyShellPane(p && p.pane))
        .catch(console.error);
    }
  }
  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitChat().catch(console.error);
    });
  }
  wireModelPicker();
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      chatForm.requestSubmit();
    });
  }
  if (chatSubtabsMore && chatMoreMenu) {
    chatSubtabsMore.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = chatMoreMenu.hidden;
      chatMoreMenu.hidden = !open;
      chatSubtabsMore.classList.toggle('is-open', open);
      chatSubtabsMore.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => {
      if (chatMoreMenu.hidden) return;
      chatMoreMenu.hidden = true;
      chatSubtabsMore.classList.remove('is-open');
      chatSubtabsMore.setAttribute('aria-expanded', 'false');
    });
  }
  if (chatSeeAllClose && chatSeeAll) {
    chatSeeAllClose.addEventListener('click', () => chatSeeAll.close());
  }
  if (chatOpenJob) {
    chatOpenJob.addEventListener('click', () => {
      const conv = conversationOf();
      const id = (conv && (conv.jobId || conv.key)) || '';
      if (id && window.magnetChrome.openChatJob) window.magnetChrome.openChatJob(id);
    });
  }
  if (ingestApprove) {
    ingestApprove.addEventListener('click', () => {
      if (window.magnetChrome.ingestApprove) window.magnetChrome.ingestApprove().catch(console.error);
    });
  }
  if (chatSubtabsPills && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (current) renderConversationRail(current);
    });
    ro.observe(chatSubtabsPills);
  }
  if (isDrawerShell) {
    applyRailTab('chat');
    applyTabsCollapsed();
    renderConversationRail({ conversation: { key: INGEST_KEY, items: [], handedness: 'right' } });
  }
} else {
  wireModelPicker();
  if (isDrawerShell) {
    applyRailTab('chat');
    applyTabsCollapsed();
    renderConversationRail({ conversation: { key: INGEST_KEY, items: [], handedness: 'right' } });
  }
}
