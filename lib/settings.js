const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function settingsFile() {
  return process.env.MAGNET_SETTINGS || path.join(__dirname, '..', 'knowledge', 'settings.yaml');
}

const { DEFAULT_ID, DEFAULT_PARAMS } = require('./models');
const layout = require('./shell-layout');
const { asHandedness } = require('./chat-tabs');
const sidebarFilters = require('./sidebar-filters');
const uiLocale = require('./ui-locale');

const DEFAULTS = {
  chatSound: true,
  contextCtrlTab: false,
  autofillQueueN: 0,
  handedness: 'right',
  uiLanguage: uiLocale.DEFAULT_ID,
  modelId: DEFAULT_ID,
  modelParams: { ...DEFAULT_PARAMS },
  customModels: [],
  sidebarWidth: layout.DEFAULT_SIDEBAR,
  drawerWidth: layout.DEFAULT_DRAWER,
  sidebarFilters: { ...sidebarFilters.DEFAULTS },
};

const FIELDS = [
  {
    key: 'chatSound',
    type: 'boolean',
    label: 'Sound when Magnet finishes',
    help: 'Play a short chime after chat, essays, or autofill — and when resume or JD fails, or a gotcha shows up.',
  },
  {
    key: 'contextCtrlTab',
    type: 'boolean',
    label: 'Context-dependent Ctrl+Tab',
    help: 'On: cycle JD/Review/Chat when assist is focused and a job is selected, otherwise cycle jobs. Off: Ctrl+Tab always cycles JD/Review/Chat (when a job is selected). Ingest does not cycle page subtabs.',
  },
  {
    key: 'handedness',
    type: 'select',
    label: 'Handedness',
    help: 'Left-handed flips JD/Review/Chat order, conversation tabs, Send/model, and the target clear button.',
    options: [
      { value: 'right', label: 'Right-handed' },
      { value: 'left', label: 'Left-handed' },
    ],
  },
  {
    key: 'uiLanguage',
    type: 'select',
    label: 'Page language',
    help: 'Force job-board and LinkedIn pages to this language, ignoring region.',
    options: uiLocale.fieldOptions(),
  },
  {
    key: 'autofillQueueN',
    type: 'number',
    min: 0,
    max: 50,
    label: 'Autofill queue',
    help: 'After the current Autofill finishes, run the next N untouched empty jobs in the list, one at a time. 0 means do not queue.',
  },
];

const ACTIONS = [
  {
    key: 'gmailConnect',
    type: 'action',
    group: 'gmail',
    groupLabel: 'Gmail',
    label: 'Sign in',
    help: 'Connect Gmail so Magnet can scan application replies.',
    invoke: 'connectMail',
    needs: 'signedOut',
  },
  {
    key: 'gmailScan',
    type: 'action',
    group: 'gmail',
    groupLabel: 'Gmail',
    label: 'Scan inbox',
    help: 'Archive rejections and application receipts. Notify you about anything else.',
    invoke: 'scanMail',
    busyLabel: 'Scanning…',
  },
  {
    key: 'gmailSignOut',
    type: 'action',
    group: 'gmail',
    groupLabel: 'Gmail',
    label: 'Sign out',
    help: 'Disconnect Gmail from this machine.',
    invoke: 'signOutMail',
    needs: 'signedIn',
  },
  {
    key: 'resumeImport',
    type: 'action',
    group: 'resumes',
    groupLabel: 'Resume vault',
    label: 'Import resume',
    help: 'Store a PDF in JobMagnet. Autofill attaches this file and will not open a picker.',
    invoke: 'importResume',
  },
  {
    key: 'exportBundle',
    type: 'action',
    group: 'sync',
    groupLabel: 'Sync',
    label: 'Export bundle',
    help: 'Write jobs, process, voice, and vault files to a JSON bundle you can copy to Android.',
    invoke: 'exportBundle',
  },
  {
    key: 'importBundle',
    type: 'action',
    group: 'sync',
    groupLabel: 'Sync',
    label: 'Import bundle',
    help: 'Load a magnet-bundle.json from the phone or another machine.',
    invoke: 'importBundle',
  },
  {
    key: 'essayLog',
    type: 'action',
    group: 'essays',
    groupLabel: 'Essays',
    label: 'Open essay log',
    help: 'Search and sort every drafted or submitted essay.',
    invoke: 'openEssayLog',
  },
];

function actionAvailable(action, mail) {
  const connected = Boolean(mail && mail.connected);
  if (action.needs === 'signedIn') return connected;
  if (action.needs === 'signedOut') return !connected;
  return true;
}

function slimMail(mail) {
  if (!mail || typeof mail !== 'object') {
    return { connected: false, email: '', scanned_at: null, indexed: 0, pending: 0 };
  }
  const pending = Array.isArray(mail.pending) ? mail.pending.length : Number(mail.pending) || 0;
  return {
    connected: Boolean(mail.connected),
    email: String(mail.email || ''),
    scanned_at: mail.scanned_at || null,
    indexed: Number(mail.indexed) || 0,
    pending,
  };
}

function asQueueN(value, fallback = DEFAULTS.autofillQueueN) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(50, Math.round(n)));
}

function asBool(value, fallback = false) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

function asModelId(value, fallback = DEFAULTS.modelId) {
  const id = String(value || '').trim();
  return id || fallback;
}

function asModelParams(value, fallback = DEFAULTS.modelParams) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  const out = {};
  for (const [key, raw] of Object.entries(src || {})) {
    if (raw == null || raw === '') continue;
    out[String(key)] = String(raw);
  }
  return out;
}

function asIdList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const row of value) {
    const id = String(row || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function asSidebarFilters(value, fallback = DEFAULTS.sidebarFilters) {
  return sidebarFilters.normalize({ ...fallback, ...(value && typeof value === 'object' ? value : {}) });
}

function normalize(doc) {
  const src = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  return {
    chatSound: asBool(src.chatSound, DEFAULTS.chatSound),
    contextCtrlTab: asBool(src.contextCtrlTab, DEFAULTS.contextCtrlTab),
    handedness: asHandedness(src.handedness),
    uiLanguage: uiLocale.asUiLanguage(src.uiLanguage),
    autofillQueueN: asQueueN(src.autofillQueueN, DEFAULTS.autofillQueueN),
    modelId: asModelId(src.modelId),
    modelParams: asModelParams(src.modelParams, src.modelId ? {} : DEFAULTS.modelParams),
    customModels: asIdList(src.customModels),
    sidebarWidth: layout.clampSidebar(src.sidebarWidth != null ? src.sidebarWidth : DEFAULTS.sidebarWidth),
    drawerWidth: layout.clampDrawer(src.drawerWidth != null ? src.drawerWidth : DEFAULTS.drawerWidth),
    sidebarFilters: asSidebarFilters(src.sidebarFilters),
  };
}

function load() {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().getSettings();
  }
  try {
    const file = settingsFile();
    if (!fs.existsSync(file)) return normalize({});
    return normalize(yaml.load(fs.readFileSync(file, 'utf8')) || {});
  } catch (err) {
    console.warn('[magnet] settings load:', err.message || err);
    return normalize({});
  }
}

function save(patch) {
  if (require('./store/mode').isSupabase()) {
    const persist = require('../packages/persist');
    persist.open();
    return persist.nodeStore().saveSettings(patch);
  }
  const next = normalize({ ...load(), ...(patch && typeof patch === 'object' ? patch : {}) });
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(next, { lineWidth: 100, noRefs: true, sortingKeys: false }), 'utf8');
  return next;
}

function snapshot(doc, extras) {
  const settings = normalize(doc || load());
  const mail = slimMail(extras && extras.mail);
  return {
    settings,
    mail,
    fields: FIELDS.map((field) => ({
      key: field.key,
      type: field.type,
      label: field.label,
      help: field.help,
      min: field.min,
      max: field.max,
      options: field.options,
      value: settings[field.key],
    })),
    actions: ACTIONS.map((action) => ({
      key: action.key,
      type: action.type,
      group: action.group,
      groupLabel: action.groupLabel,
      label: action.label,
      help: action.help,
      invoke: action.invoke,
      busyLabel: action.busyLabel || action.label,
      available: actionAvailable(action, mail),
    })),
  };
}

function ctrlTabTarget(doc, chatFocused) {
  if (normalize(doc).contextCtrlTab && !chatFocused) return 'job';
  return 'chat';
}

module.exports = {
  DEFAULTS,
  FIELDS,
  ACTIONS,
  asModelId,
  asModelParams,
  asIdList,
  asHandedness,
  asUiLanguage: uiLocale.asUiLanguage,
  asSidebarFilters,
  settingsFile,
  normalize,
  load,
  save,
  snapshot,
  slimMail,
  actionAvailable,
  ctrlTabTarget,
};
