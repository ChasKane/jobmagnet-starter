const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  session,
  clipboard,
  shell,
  Menu,
  dialog,
} = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const yaml = require('js-yaml');
const { loadJobsFile } = require('./lib/jobs-file');
const { loadState, bump, unbump, seedSubmitted } = require('./lib/application-state');
const outcomeUndo = require('./lib/outcome-undo');
const {
  getRecord,
  statusOf,
  isOpen,
  writeRecord,
  appendEvent,
  seedFromLegacyFlags,
  seedSupabaseStatus,
  filterBucket,
} = require('./lib/process-store');
const { pickResume, loadResumes, watchResumes } = require('./lib/resume-pick');
const { runAutofill, runEssays, ensureTabJd, evalFirstOk, FIND_FILE_SCRIPT, VERIFY_FILE_SCRIPT, GREENHOUSE_UPLOADER_SCRIPT, GREENHOUSE_RESUME_CHANGE_SCRIPT, loadSession, saveSession, applyMirrorSave, flushEssayMirrorsScript, retryField, retryReviewField, snapshotPage, syncEssayFinals, harvestApplicantEssays, harvestTabAnswers, harvestStaticField, harvestSweepStaticFields, acceptReviewFill, acceptReviewRecipe, acceptReviewRun, rewriteReviewRun, answerReviewAsk, reviewFieldChat, learnReviewSteps, startFillRecord, stopFillRecord, confirmFillRecord, openFlagReview, cancelReview, cancelFill, attachFillAbort, isFillCancelled } = require('./lib/autofill');
const { cacheSnapshot, watchStrategy, refreshStrategy, flushStrategy } = require('./lib/strategy');
watchStrategy(() => notifyChrome());
watchResumes(() => notifyChrome());
const { FLAG_SCRIPT, flashFieldScript, chatTargetScript } = require('./lib/paint');
const {
  captureJd,
  looksLikeJobDescription,
  shouldReplaceJd,
  needsJdCapture,
  expandAbbreviatedJd,
  isSummarizedJd,
  NEED_FULL_JD_HINT,
  LIST_VISIBLE_CTAS_SCRIPT,
  fillApplyCue,
} = require('./lib/jd');
const { commitVoice, bindShippedMagnet } = require('./lib/voice-commit');
const { runIngestChat } = require('./lib/ingest-chat');
const setupGuide = require('./lib/setup-guide');
const { executeSearchPlan } = require('./lib/ingest-sdk');
const { looksLikeApprove, normalizeSchema } = require('./packages/core/src/search-schema');
const { heldCompanyLabels, listingAlreadyHeld } = require('./packages/core/src/company-hold');
const { boardFromUrl: holdBoardFromUrl } = require('./packages/core/src/boards');
const { snapshotScript, clickScript, typeScript, scrollScript, readRefScript, ALREADY_LISTED } = require('./packages/core/src/hunt-page');
const { loginWall, loginPrompt } = require('./packages/core/src/login-wall');
const { huntStartUrls } = require('./packages/core/src/hunt-start');
const { hasAutofillRun, asQueueN } = require('./packages/core/src/autofill-queue');
const { formatAskAnswers } = require('./lib/chat-tools');
const { resolveStoryAsks } = require('./lib/story-confirm');
const {
  ASK_ID,
  eligiblePairs,
  parseCannedChoice,
  acceptLessons,
  formatAcceptReply,
} = require('./lib/voice-debrief');
const { learnRecipe } = require('./lib/field-recipes');
const { scanJobDescription } = require('./lib/jd-scan');
const { loadRichboi, saveRichboi, loadSystemPrompt, saveSystemPrompt, preferPostingJd } = require('./lib/essay-prompt');
const graph = require('./lib/graph');
const { saveUserVoice, revertVoice, acceptPending } = require('./lib/voice-compact');
const { htmlToJdText } = require('./lib/jd-format');
const { seedBoardsFromJobs, appendJobs } = require('./lib/discover');
const { mergeJobEntries, loadSubmissions, submissionByUrl, syncFromOriginAsync, LEDGER_FILE } = require('./lib/ai-submissions');
const { loadChat, loadChatState, saveChat, listChats, loadChatUi, saveChatUi } = require('./lib/tab-chat');
const chatTabs = require('./lib/chat-tabs');
const { HUNT_TAB_ID, isHuntTab, huntShowsApply } = require('./lib/hunt-surface');
const { mailNotice, targetUrls, alreadyNotified, unreadMailNotices, markMailRead } = require('./packages/core/src/mail-notify');
const { chromeTarget, applyFocusEvent, dismissChatTarget, clearIfMissing } = require('./lib/chat-target');
const { expandThread, disposeTabAgent } = require('./lib/tab-agent');
const agentClient = require('./lib/agent-client');
const { createTiming } = require('./lib/timing');
const settings = require('./lib/settings');
const uiLocale = require('./lib/ui-locale');
const sidebarFilters = require('./lib/sidebar-filters');
const models = require('./lib/models');
const { collectAlertFindings, takeNewAlerts, formatAlertChat, chatFolds, shouldPing, silentFail } = require('./lib/attention');
const { attachContextMenu } = require('./lib/context-menu');
const shellLayout = require('./lib/shell-layout');
const persist = require('./packages/persist');
const { canResume, snapshotSession, restoreState, resumeHint, normalizeSession } = require('./lib/hunt-session');
const pageFind = require('./lib/page-find');
const { createElectronMagnet } = require('./lib/magnet-electron');
const { scanInbox, resolveQueue, mailStatus, mailForJob } = require('./lib/mail/scan');
const {
  authUrl,
  exchangeCode,
  accessToken,
  connected: gmailConnected,
  credentials,
  oauthReady,
  signedInEmail,
  needsModifyConsent,
  signOut: gmailSignOut,
} = require('./lib/mail/oauth');
const { notifyMail } = require('./lib/mail/notify-os');
const { codeQuery, pickVerificationCode, fetchGmailCodeMessages } = require('./lib/mail/verification-code');
const { THREAD_IDS_JS, searchUrl, printUrl, parsePrintView, inboxUrl } = require('./lib/mail/gmail-web');

if (!process.env.MAGNET_PORT) process.env.MAGNET_PORT = '3872';
app.setName('JobMagnet Starter');
app.setPath(
  'userData',
  path.join(app.getPath('home'), 'Library', 'Application Support', 'jobmagnet-starter'),
);

const CHROME_HEIGHT_BASE = 80;
const CHROME_CHIPS_EXTRA = 48;
const CHROME_FIND_EXTRA = 40;
const FOOTER_HEIGHT = 52;
const FOOTER_REVIEW_HEIGHT = 80;
const UNDO_TOAST_HEIGHT = 44;
const COMPACT_MAX_WIDTH = 900;
const SHELL_TAB_HEIGHT = 48;
const SHELL_PANES = ['jobs', 'apply', 'chat'];
const CONTROL_PORT = Number(process.env.MAGNET_PORT || 3872);
const JOBS_FILE = process.env.MAGNET_JOBS_FILE
  ? path.resolve(process.env.MAGNET_JOBS_FILE)
  : path.join(__dirname, 'knowledge', 'jobs.yaml');
const MERGE_AI_SUBMISSIONS = !process.env.MAGNET_JOBS_FILE;
const SHARED_PARTITION = 'persist:jobmagnet';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/172.16.1.3 Safari/537.36';

let mainWindow = null;
let sidebarView = null;
let chromeView = null;
let footerView = null;
let drawerView = null;
let dockView = null;
let splitLeft = null;
let splitRight = null;
let splitDrag = null;
let sidebarWidth = shellLayout.DEFAULT_SIDEBAR;
let drawerWidth = shellLayout.DEFAULT_DRAWER;
/** @type {Map<string, object>} */
const tabs = new Map();
let activeTabId = null;
let findBarOpen = false;
let findSession = { query: '', frame: -1 };
let drawerOpen = true;
let drawerTab = 'chat';
let shellPane = 'apply';
let systemPromptPending = null;
let systemPromptTimer = null;
let flagging = false;
let urlCopyArmed = false;
let sidebarFilter = sidebarFilters.normalize();
let sessionCounts = { submitted: 0, passed: 0, rejected: 0 };
let lifetimeTotals = loadState().totals;
let pendingOutcome = null;
let richboiPending = null;
let richboiTimer = null;
const INGEST_CHAT_KEY = chatTabs.INGEST_KEY;
const PAGE_TABS = chatTabs.PAGE_TABS_RIGHT;
let ingestChat = [];
let ingestBusy = false;
let ingestAbort = null;
let ingestCancelRequested = false;
let ingestOpen = false;
let chatUi = chatTabs.normalizeUi();
let chatStoreReady = false;
let ingestPlan = null;
let huntState = emptyHuntState();
let huntReturnTabId = null;
let huntReturnPane = null;
let chromeChipsOpen = false;
let autofillChainLeft = 0;
const timing = createTiming();
let oauthWait = null;
let appSettings = settings.load();
sidebarWidth = appSettings.sidebarWidth;
drawerWidth = appSettings.drawerWidth;
sidebarFilter = sidebarFilters.normalize(appSettings.sidebarFilters);
app.commandLine.appendSwitch('lang', uiLocale.chromiumLang(appSettings.uiLanguage));
let magnetApp = null;

function currentRichboi() {
  return richboiPending != null ? richboiPending : loadRichboi();
}

function flushRichboi() {
  clearTimeout(richboiTimer);
  richboiTimer = null;
  if (richboiPending == null) return currentRichboi();
  saveRichboi(richboiPending);
  richboiPending = null;
  return loadRichboi();
}

function queueRichboi(text) {
  richboiPending = String(text ?? '');
  clearTimeout(richboiTimer);
  richboiTimer = setTimeout(() => {
    flushRichboi();
  }, 500);
}

function currentSystemPrompt() {
  return systemPromptPending != null ? systemPromptPending : loadSystemPrompt();
}

function flushSystemPrompt() {
  clearTimeout(systemPromptTimer);
  systemPromptTimer = null;
  if (systemPromptPending == null) return currentSystemPrompt();
  saveSystemPrompt(systemPromptPending);
  systemPromptPending = null;
  return loadSystemPrompt();
}

function queueSystemPrompt(text) {
  systemPromptPending = String(text ?? '');
  clearTimeout(systemPromptTimer);
  systemPromptTimer = setTimeout(() => {
    flushSystemPrompt();
  }, 500);
}

function sentDraftsFrom(result) {
  const fields = ((((result || {}).sent || {}).payload || {}).fields) || [];
  return fields
    .filter((f) => f && String(f.current || '').trim())
    .map((f) => ({ id: f.id, label: f.label || f.id, text: String(f.current) }));
}

function appendAlertBubble(tab, alerts) {
  const text = formatAlertChat(alerts);
  if (!tab || !text) return false;
  tab.chat = Array.isArray(tab.chat) ? tab.chat : [];
  tab.chat.push({
    role: 'magnet',
    kind: 'alert',
    text,
    at: Date.now(),
  });
  return true;
}

function appendMagnetChat(tab, result) {
  if (!tab || (result && result.cancelled)) return false;
  tab.chat = Array.isArray(tab.chat) ? tab.chat : [];
  const alerts = (result && result.alerts) || [];
  const folds = Array.isArray(result && result.folds) ? result.folds : chatFolds(result, tab);
  let reply = String((result && result.reply) || '').trim();
  const drafts = (result && result.drafts) || [];
  const received = result && result.received;
  const receivedOnlyError = Boolean(received && received.error && Object.keys(received).every((k) => k === 'error' || received[k] == null));
  const hasBody = Boolean(reply || drafts.length || (result && result.sent) || (received && !receivedOnlyError) || folds.length);
  if (silentFail(result) && !hasBody && !alerts.length) return false;
  if (!hasBody && !alerts.length) return false;
  if (hasBody) {
    tab.chat.push({
      role: 'magnet',
      kind: (result && result.kind) || undefined,
      text: reply || (folds.length ? '' : drafts.length ? `Drafted ${drafts.length} field${drafts.length === 1 ? '' : 's'}.` : 'Okay.'),
      drafts,
      folds,
      tools: (result && result.tools) || [],
      asks: (result && result.asks) || [],
      sent: (result && result.sent) || null,
      received: receivedOnlyError ? null : received || null,
      at: Date.now(),
    });
  }
  appendAlertBubble(tab, alerts);
  if (tab.chat.length > 200) tab.chat = tab.chat.slice(-200);
  persistChat(tab);
  return true;
}

function pingAttention(kind, result, extras = {}) {
  if (!appSettings || !appSettings.chatSound) return;
  if (!shouldPing(kind, result, extras)) return;
  if (drawerView) drawerView.webContents.send('magnet:attention-sound');
}

function noticeCompletion(tab, kind, result, opts = {}) {
  if (result && result.cancelled) return { alerts: [] };
  const alerts = tab ? takeNewAlerts(tab, collectAlertFindings(tab)) : [];
  const quiet = kind === 'jd' || kind === 'resume';
  const failed = Boolean(result && (result.ok === false || result.error || (tab && tab.essayError)));
  if (!opts.skipChatLog && tab) {
    const payload = quiet && !failed ? { alerts } : { ...(result || {}), alerts };
    if (appendMagnetChat(tab, payload) && (failed || alerts.length)) openChatDrawer(tab);
    notifyChrome();
  }
  pingAttention(kind, result, { hasAlerts: alerts.length > 0 });
  return { alerts };
}

function persistChat(tab) {
  if (!tab || !tab.hydrated || !tab.meta || !tab.meta.url) return;
  try {
    saveChat(tab.meta.url, tab.chat, {
      company: tab.meta.name,
      title: tab.meta.title,
      folded: tab.chatFolded || [],
      agentId: tab.agentId || '',
      snapshotKey: tab.agentSnapshotKey || '',
      pageSubtab: chatTabs.asPageSubtab(tab.pageSubtab),
    });
  } catch (err) {
    console.warn('[magnet] persist chat:', err.message || err);
  }
}

let uiSaveTimer = null;

function scheduleUiSave() {
  clearTimeout(uiSaveTimer);
  uiSaveTimer = setTimeout(() => {
    uiSaveTimer = null;
    const snapshot = chatUi;
    try {
      const api = persist.nodeStore();
      if (require('./lib/store/mode').isSupabase() && typeof api.saveChatUiAsync === 'function') {
        api.saveChatUiAsync(snapshot).catch((err) => console.warn('[magnet] persist ui:', (err && err.message) || err));
        return;
      }
    } catch (_) {}
    try {
      saveChatUi(snapshot);
    } catch (err) {
      console.warn('[magnet] persist ui:', err.message || err);
    }
  }, 300);
}

function persistUi(next) {
  chatUi = chatTabs.normalizeUi(next);
  scheduleUiSave();
  return chatUi;
}

function activeChatKey() {
  return chatTabs.normalizeUi(chatUi).active;
}

function chatKeyOfTab(tab) {
  return tab && tab.meta && tab.meta.url ? String(tab.meta.url) : '';
}

function tabByChatKey(key) {
  const k = String(key || '');
  if (!chatTabs.isJobKey(k)) return null;
  for (const tab of tabs.values()) {
    if (!tab.meta) continue;
    if (tab.meta.url === k || tab.meta.id === k) return tab;
  }
  return null;
}

function conversationItems() {
  const ui = chatTabs.normalizeUi(chatUi);
  const items = [];
  const seen = new Set();
  for (const key of ui.mru) {
    if (!chatTabs.isJobKey(key) || seen.has(key)) continue;
    seen.add(key);
    const tab = tabByChatKey(key);
    const company = (tab && tab.meta && (tab.meta.name || tab.meta.company)) || '';
    const title = (tab && tab.meta && tab.meta.title) || '';
    items.push({
      key,
      kind: 'job',
      label: chatTabs.chatTabLabel(company || title),
      company,
      title,
      jobId: tab ? tab.meta.id : '',
    });
  }
  return items;
}

function ensureJobChat(tab) {
  if (!tab || !tab.meta || tab.meta.id === HUNT_TAB_ID) return;
  const key = chatKeyOfTab(tab);
  if (!chatTabs.isJobKey(key)) return;
  persistUi(chatTabs.ensureTab(chatUi, key));
}

function selectJobPage(tab, subtab) {
  if (!tab || !tab.meta) return;
  tab.pageChosen = true;
  hydrateTab(tab);
  const key = chatKeyOfTab(tab);
  persistUi(chatTabs.selectTab(chatTabs.ensureTab(chatUi, key), key));
  tab.pageSubtab = chatTabs.asPageSubtab(subtab);
  persistChat(tab);
  openDrawer(tab.pageSubtab);
  notifyChrome();
}

function selectConversation(key, opts = {}) {
  const k = String(key || chatTabs.INGEST_KEY).trim() || chatTabs.INGEST_KEY;
  persistUi(chatTabs.selectTab(chatTabs.ensureTab(chatUi, k), k));
  if (chatTabs.isJobKey(k)) {
    const tab = tabByChatKey(k);
    if (tab) hydrateTab(tab);
    const stored = tab ? chatTabs.asPageSubtab(tab.pageSubtab) : 'chat';
    const sub = opts.pageSubtab ? chatTabs.asPageSubtab(opts.pageSubtab) : stored;
    if (tab) {
      tab.pageSubtab = sub;
      persistChat(tab);
    } else if (opts.pageSubtab) {
      const state = loadChatState(k);
      saveChat(k, state.messages, { pageSubtab: sub });
    }
    drawerTab = sub;
    if (opts.forceOpen && tab) {
      tab.mode = 'ats';
      ensureAtsView(tab);
      activateTab(tab.meta.id);
    } else if (opts.activate !== false && tab && tab.atsView) {
      activateTab(tab.meta.id);
    }
  }
  drawerOpen = true;
  ensureDrawerView();
  if (isCompactLayout()) setShellPane('chat', { relayout: false });
  if (drawerView) drawerView.webContents.send('magnet:drawer-mode', drawerTab);
  if (chromeView) chromeView.webContents.send('magnet:drawer-mode', drawerTab);
  notifyChrome();
}

function conversationOverlay(applyTab) {
  const key = activeChatKey();
  const handedness = chatTabs.asHandedness(appSettings && appSettings.handedness);
  const items = conversationItems();
  const base = {
    conversation: {
      key,
      kind: chatTabs.isIngest(key) ? 'ingest' : 'job',
      pageRail: chatTabs.pageRailVisible(key),
      pageSubtab: chatTabs.isIngest(key) ? '' : chatTabs.asPageSubtab(drawerTab),
      handedness,
      items,
      applyMatches: false,
      canOpen: false,
      openLabel: '',
      jobId: '',
    },
    handedness,
    ingestChat,
    ingestBusy,
    ingestPlan: lastIngestPlan(),
    huntResume: currentHuntResume(),
  };
  if (chatTabs.isIngest(key)) {
    return {
      ...base,
      chat: ingestChat,
      chatFolded: [],
      chatStream: null,
      jd: null,
      posting: '',
      hasJd: false,
      debugFields: [],
      lastLlm: null,
      lastReview: null,
      review: null,
      reviewFocus: '',
      reviewFlashId: '',
      reviewFlashAt: 0,
      focusedFieldId: '',
      chatTarget: null,
      targetBarText: '',
      teachPending: null,
      skippedReview: false,
      reviewCancellable: false,
      reviewNotes: [],
      fillRecord: null,
      reviewFieldChats: {},
      essaySession: { fields: [] },
    };
  }
  const tab = tabByChatKey(key);
  if (tab) {
    const match = Boolean(applyTab && applyTab.meta && applyTab.meta.id === tab.meta.id);
    const label = chatTabs.chatTabLabel(tab.meta.name || tab.meta.title);
    return {
      ...base,
      conversation: {
        ...base.conversation,
        jobId: tab.meta.id,
        pageSubtab: chatTabs.asPageSubtab(tab.pageSubtab || drawerTab),
        applyMatches: match,
        canOpen: !tab.atsView || !match,
        openLabel: `Open ${label}`,
      },
      jd: preferPostingJd(tab) || tab.jd,
      posting: (tab.meta && (tab.meta.posting || tab.meta.linkedin)) || '',
      hasJd: Boolean((preferPostingJd(tab) || tab.jd || {}).text),
      debugFields: tab.debugFields || [],
      lastLlm: tab.lastLlm || null,
      lastReview: tab.lastReview || null,
      review: tab.review || null,
      reviewFocus: tab.reviewFocus || '',
      reviewFlashId: tab.reviewFlashId || '',
      reviewFlashAt: tab.reviewFlashAt || 0,
      focusedFieldId: match ? tab.focusedFieldId || '' : '',
      ...(match ? chromeTarget(tab) : { chatTarget: null, targetBarText: '', teachPending: null }),
      chatStream: tab.chatStream || null,
      chatFolded: tab.chatFolded || [],
      skippedReview: Boolean(tab.skippedReview),
      reviewCancellable: Boolean(tab.reviewAbort),
      reviewNotes: tab.reviewNotes || [],
      fillRecord: tab.fillRecord || null,
      reviewFieldChats: tab.reviewFieldChats || {},
      chat: tab.chat || [],
      essaySession: tab.essaySession || { fields: [] },
    };
  }
  const label = chatTabs.chatTabLabel('');
  return {
    ...base,
    conversation: {
      ...base.conversation,
      canOpen: false,
      openLabel: `Open ${label}`,
    },
    jd: null,
    posting: '',
    hasJd: false,
    chat: [],
    chatFolded: [],
    chatStream: null,
    debugFields: [],
    lastLlm: null,
    lastReview: null,
    review: null,
    reviewFocus: '',
    reviewFlashId: '',
    reviewFlashAt: 0,
    focusedFieldId: '',
    chatTarget: null,
    skippedReview: false,
    reviewCancellable: false,
    reviewNotes: [],
    fillRecord: null,
    reviewFieldChats: {},
    essaySession: { fields: [] },
  };
}

function unwrapInvoke(ev) {
  return (ev && ev.result) || ev;
}

function markDebriefAsksAnswered(tab) {
  for (const m of tab.chat || []) {
    for (const a of m.asks || []) {
      if (a && a.id === ASK_ID) a.answered = true;
    }
  }
}

async function startDebrief(tab) {
  const pairs = (tab.debrief && tab.debrief.pairs) || [];
  if (!pairs.length) return;
  tab.debrief.status = 'thinking';
  tab.chatStream = { text: '', stage: 'Thinking…', mode: 'discuss' };
  sendChatDelta(tab);
  notifyChrome();
  try {
    const out = unwrapInvoke(
      await agentClient.invoke(
        'voice-debrief',
        { pairs, company: tab.meta && tab.meta.name, history: tab.chat || [] },
        { timeout: 180000 }
      )
    );
    tab.chatStream = null;
    if (!out || out.ok === false) {
      tab.debrief.status = 'empty';
      return;
    }
    tab.debrief.proposed = out.proposed || null;
    tab.debrief.status = out.empty ? 'empty' : 'open';
    appendMagnetChat(tab, { reply: out.reply, asks: out.asks || [], kind: 'debrief' });
    notifyChrome();
    pingAttention('chat', out);
  } catch (err) {
    tab.chatStream = null;
    tab.debrief.status = 'empty';
    console.warn('[magnet] voice debrief:', (err && err.message) || err);
    appendMagnetChat(tab, {
      reply: 'Could not diagnose those essay edits. Say what Magnet should remember from this apply, or skip.',
    });
    notifyChrome();
  }
}

async function handleDebriefSend(tab, instruction) {
  const proposed = tab.debrief && tab.debrief.proposed;
  const choice = parseCannedChoice(instruction);
  if (choice && (choice === 'skip' || proposed)) {
    const result = await acceptLessons(proposed || {}, choice, {
      pairs: tab.debrief.pairs,
      userText: instruction,
    });
    tab.debrief.status = choice === 'skip' ? 'skipped' : 'accepted';
    markDebriefAsksAnswered(tab);
    const reply = formatAcceptReply(result, choice);
    tab.chat.push({ role: 'magnet', text: reply, kind: 'debrief', at: Date.now() });
    persistChat(tab);
    notifyChrome();
    return { ok: true, reply };
  }
  tab.chatStream = { text: '', stage: 'Thinking…', mode: 'discuss' };
  tab.debrief.status = 'thinking';
  sendChatDelta(tab);
  try {
    const out = unwrapInvoke(
      await agentClient.invoke(
        'voice-debrief',
        {
          followUp: true,
          pairs: tab.debrief.pairs,
          proposed,
          instruction,
          history: tab.chat || [],
          company: tab.meta && tab.meta.name,
        },
        { timeout: 180000 }
      )
    );
    tab.chatStream = null;
    if (out && (out.accepted || out.skipped)) {
      tab.debrief.status = out.skipped ? 'skipped' : 'accepted';
      markDebriefAsksAnswered(tab);
    } else {
      tab.debrief.status = 'open';
    }
    appendMagnetChat(tab, {
      reply: (out && out.reply) || 'Okay.',
      asks: (out && out.asks) || [],
      tools: (out && out.tools) || [],
      kind: 'debrief',
    });
    notifyChrome();
    return out || { ok: true, reply: 'Okay.' };
  } catch (err) {
    tab.chatStream = null;
    tab.debrief.status = 'open';
    console.warn('[magnet] voice debrief follow-up:', (err && err.message) || err);
    const reply = 'Could not save that. Try Keep all, Skip, or say it again.';
    tab.chat.push({ role: 'magnet', text: reply, kind: 'debrief', at: Date.now() });
    persistChat(tab);
    notifyChrome();
    return { ok: false, reply };
  }
}

function sidebarNotices() {
  const jobs = [...tabs.values()].map((tab) => ({
    id: tab.meta.id,
    url: tab.meta.url,
    company: tab.meta.name,
    title: tab.meta.title,
  }));
  const byUrl = new Map();
  for (const row of listChats()) {
    byUrl.set(row.url, { key: row.url, url: row.url, company: row.company, title: row.title, messages: row.messages });
  }
  for (const tab of tabs.values()) {
    byUrl.set(tab.meta.url, {
      key: tab.meta.url,
      url: tab.meta.url,
      company: tab.meta.name,
      title: tab.meta.title,
      messages: tab.chat || [],
    });
  }
  return unreadMailNotices([...byUrl.values()], jobs);
}

function notifyUnsureMail(queued) {
  let posted = 0;
  for (const item of queued || []) {
    const notice = mailNotice(item);
    const urls = targetUrls(item);
    const keys = urls.length ? urls : ['__mail__'];
    for (const url of keys) {
      const tab = [...tabs.values()].find((t) => t.meta && t.meta.url === url);
      if (tab) {
        if (alreadyNotified(tab.chat, notice.mailId)) continue;
        tab.chat = [...(tab.chat || []), notice];
        persistChat(tab);
        posted += 1;
        continue;
      }
      const msgs = loadChat(url);
      if (alreadyNotified(msgs, notice.mailId)) continue;
      msgs.push(notice);
      saveChat(url, msgs, {});
      posted += 1;
    }
  }
  if (posted) {
    notifyChrome();
    notifySidebar();
    pingAttention('chat', { ok: true });
  }
  return posted;
}

function chromeHeight() {
  const extra = findBarOpen ? CHROME_FIND_EXTRA : 0;
  const chips = chromeChipsOpen ? CHROME_CHIPS_EXTRA : 0;
  if (isCompactLayout() && mainWindow) {
    const [width] = mainWindow.getContentSize();
    if (width <= 640) return 118 + extra + chips;
  }
  return CHROME_HEIGHT_BASE + extra + chips;
}

function focusFindBar({ select = false } = {}) {
  if (!findBarOpen || !chromeView) return;
  try {
    if (mainWindow) mainWindow.focus();
    chromeView.webContents.focus();
  } catch (_) {}
  chromeView.webContents.send(select ? 'magnet:find-open' : 'magnet:find-focus');
}

function openFindBar() {
  const wasOpen = findBarOpen;
  findBarOpen = true;
  layout();
  focusFindBar({ select: !wasOpen });
}

function findFrames(wc) {
  const frames = [wc];
  try {
    if (wc.mainFrame && wc.mainFrame.frames) frames.push(...wc.mainFrame.frames);
  } catch (_) {}
  return frames;
}

async function clearPageFind(wc) {
  if (!wc) return;
  const wipe = pageFind.script('', {});
  for (const frame of findFrames(wc)) {
    try {
      await frame.executeJavaScript(wipe, false);
    } catch (_) {}
  }
}

function closeFindBar() {
  const wc = activeWc();
  if (wc) {
    try {
      wc.stopFindInPage('clearSelection');
    } catch (_) {}
    clearPageFind(wc).catch(() => {});
  }
  findBarOpen = false;
  findSession = { query: '', frame: -1 };
  layout();
  if (chromeView) chromeView.webContents.send('magnet:find-close');
}

async function runFind(opts) {
  const wc = activeWc();
  if (!wc) return;
  const text = String((opts && opts.text) || '');
  const frames = findFrames(wc);
  const send = (result) => {
    if (chromeView) chromeView.webContents.send('magnet:find-result', result || { matches: 0 });
  };
  const run = (frame, payload) => frame.executeJavaScript(pageFind.script(text, payload), false).catch(() => null);
  if (!text) {
    await clearPageFind(wc);
    findSession = { query: '', frame: -1 };
    send({ matches: 0, activeMatchOrdinal: 0, finalUpdate: true });
    return;
  }
  const next = Boolean(opts && opts.findNext) && findSession.query === text && findSession.frame >= 0;
  if (next) {
    const frame = frames[findSession.frame] || wc;
    const result = await run(frame, { findNext: true, forward: !opts || opts.forward !== false, activate: true });
    send(result);
    return;
  }
  let best = { matches: 0, activeMatchOrdinal: 0, finalUpdate: true };
  let bestI = -1;
  for (let i = 0; i < frames.length; i++) {
    const result = await run(frames[i], { findNext: false, activate: false });
    if (result && result.matches > best.matches) {
      best = result;
      bestI = i;
    }
  }
  if (bestI >= 0) {
    const result = await run(frames[bestI], { findNext: false, activate: true });
    if (result) best = result;
  }
  findSession = { query: text, frame: bestI };
  send(best);
}

function loadDotEnv() {
  const p = path.join(__dirname, '.env');
  try {
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (_) {}
}

function isAuthPopupUrl(url) {
  if (!url || url === 'about:blank') return false;
  try {
    const u = new URL(url);
    if (/accounts\.google\.com$|login\.microsoftonline\.com$|appleid\.apple\.com$/i.test(u.hostname)) return true;
    return /\/(oauth|authorize|saml|login|checkpoint)/i.test(u.pathname);
  } catch {
    return false;
  }
}

function unwrapNavigationUrl(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)linkedin\.com$/i.test(u.hostname) && /\/safety\/go/i.test(u.pathname)) {
      const target = u.searchParams.get('url');
      if (target && /^https?:\/\//i.test(target)) return target;
    }
  } catch (_) {}
  return url;
}

function currentUiLanguage() {
  return uiLocale.asUiLanguage(appSettings && appSettings.uiLanguage);
}

function withPageLocale(url) {
  return uiLocale.withUiLocale(url, currentUiLanguage());
}

function acceptLanguageExtraHeaders() {
  return `Accept-Language: ${uiLocale.acceptLanguageHeader(currentUiLanguage())}\r\n`;
}

function loadPageUrl(wc, url) {
  if (!wc) return;
  return wc.loadURL(withPageLocale(url), { extraHeaders: acceptLanguageExtraHeaders() });
}

let pageLanguageSessionReady = false;

function applyLinkedInLangCookies(ses) {
  const values = uiLocale.linkedinLangCookie(currentUiLanguage());
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  Promise.all([
    ses.cookies.set({
      url: 'https://www.linkedin.com',
      name: 'lang',
      value: values.lang,
      domain: '.linkedin.com',
      path: '/',
      expirationDate: expires,
    }),
    ses.cookies.set({
      url: 'https://www.linkedin.com',
      name: 'li_lang',
      value: values.li_lang,
      domain: '.linkedin.com',
      path: '/',
      expirationDate: expires,
    }),
  ]).catch((err) => {
    console.warn('[magnet] linkedin lang cookies:', (err && err.message) || err);
  });
}

function installPageLanguageSession() {
  const ses = session.fromPartition(SHARED_PARTITION);
  if (!pageLanguageSessionReady) {
    pageLanguageSessionReady = true;
    ses.webRequest.onBeforeSendHeaders((details, cb) => {
      const headers = {
        ...details.requestHeaders,
        'Accept-Language': uiLocale.acceptLanguageHeader(currentUiLanguage()),
      };
      cb({ requestHeaders: headers });
    });
  }
  applyLinkedInLangCookies(ses);
}

function reloadAtsViewsForLanguage() {
  for (const tab of tabs.values()) {
    if (!tab.atsView || !tab.atsView.webContents) continue;
    const wc = tab.atsView.webContents;
    const here = wc.getURL && wc.getURL();
    if (here && /^https?:/i.test(here)) loadPageUrl(wc, here);
  }
}

function isCompactLayout() {
  if (!mainWindow) return false;
  const [width] = mainWindow.getContentSize();
  return width <= COMPACT_MAX_WIDTH;
}

function contentBounds() {
  const [width, height] = mainWindow ? mainWindow.getContentSize() : [1280, 860];
  const ch = chromeHeight();
  const fh = footerHeight();
  const compact = isCompactLayout();
  const dock = compact ? SHELL_TAB_HEIGHT : 0;
  if (compact) {
    return {
      x: 0,
      y: ch,
      width: Math.max(100, width),
      height: Math.max(100, height - ch - fh - dock),
    };
  }
  return shellLayout.desktopShellBounds({
    width,
    height,
    sidebarWidth,
    drawerWidth,
    chromeHeight: ch,
    footerHeight: fh,
  }).webview;
}

function setShellPane(pane, { relayout = true } = {}) {
  const next = SHELL_PANES.includes(pane) ? pane : 'apply';
  if (shellPane !== next) shellPane = next;
  notifyShellPane();
  if (relayout) layout();
}

function notifyShellPane() {
  const payload = { pane: shellPane, compact: isCompactLayout() };
  if (dockView) dockView.webContents.send('magnet:shell-pane', payload);
  if (sidebarView) sidebarView.webContents.send('magnet:shell-pane', payload);
  if (chromeView) chromeView.webContents.send('magnet:shell-pane', payload);
  if (drawerView) drawerView.webContents.send('magnet:shell-pane', payload);
}

function isReviewingTab(tab) {
  if (!tab || tab.autofillStatus !== 'running') return false;
  if (tab.reviewAbort) return true;
  if (tab.runKind === 'all') return false;
  return tab.autofillStep === 'Review' || /reviewing leftovers/i.test(tab.autofillDetail || '');
}

function footerHeight() {
  const tab = activeTabId && tabs.get(activeTabId);
  const base = isReviewingTab(tab) ? FOOTER_REVIEW_HEIGHT : FOOTER_HEIGHT;
  const undo = pendingOutcome ? UNDO_TOAST_HEIGHT : 0;
  if (isCompactLayout() && mainWindow) {
    const [width] = mainWindow.getContentSize();
    if (width <= 640) return base + 44 + undo;
  }
  return base + undo;
}

function parkView(view, width, height) {
  if (!view) return;
  setViewBounds(view, { x: -(Math.max(width, 200) + 80), y: 0, width: Math.max(width, 200), height: Math.max(height, 100) });
}

function sameBounds(a, b) {
  return Boolean(
    a &&
      b &&
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height
  );
}

function setViewBounds(view, bounds) {
  if (!view || !bounds) return;
  if (sameBounds(view.__magnetBounds, bounds)) return;
  view.__magnetBounds = bounds;
  view.setBounds(bounds);
}

function raiseView(view) {
  if (!view || !mainWindow) return;
  try {
    mainWindow.setTopBrowserView(view);
  } catch (_) {
    try {
      mainWindow.addBrowserView(view);
    } catch (_) {}
  }
}

function layoutSplitters(shell, { jobsOn, chatOn } = {}) {
  if (!splitLeft || !splitRight || !mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  if (isCompactLayout() || !jobsOn || !chatOn) {
    parkView(splitLeft, shellLayout.SPLITTER, height);
    parkView(splitRight, shellLayout.SPLITTER, height);
    return;
  }
  if (splitDrag && splitDrag.which === 'sidebar') {
    setViewBounds(splitLeft, { x: 0, y: 0, width, height });
    raiseView(splitLeft);
    setViewBounds(splitRight, shell.splitRight);
    return;
  }
  if (splitDrag && splitDrag.which === 'drawer') {
    setViewBounds(splitRight, { x: 0, y: 0, width, height });
    raiseView(splitRight);
    setViewBounds(splitLeft, shell.splitLeft);
    return;
  }
  setViewBounds(splitLeft, shell.splitLeft);
  setViewBounds(splitRight, shell.splitRight);
  raiseView(splitLeft);
  raiseView(splitRight);
}

function layout(opts = {}) {
  if (!mainWindow || !sidebarView) return;
  const restack = opts.restack !== false;
  const [width, height] = mainWindow.getContentSize();
  const compact = isCompactLayout();
  const ch = chromeHeight();
  const fh = footerHeight();
  const dockH = compact ? SHELL_TAB_HEIGHT : 0;
  const workH = Math.max(100, height - dockH);
  const applyOn = !compact || shellPane === 'apply';
  const jobsOn = !compact || shellPane === 'jobs';
  const chatOn = !compact || shellPane === 'chat';
  if (!compact) {
    const shell = shellLayout.desktopShellBounds({
      width,
      height,
      sidebarWidth,
      drawerWidth,
      chromeHeight: ch,
      footerHeight: fh,
    });
    sidebarWidth = shell.panels.sidebar;
    drawerWidth = shell.panels.drawer;
    const bounds = shell.webview;
    const hidden = {
      x: -(bounds.width + shell.sidebar.width + 80),
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
    for (const [id, tab] of tabs) {
      const showAts = applyOn && tab.mode === 'ats' && id === activeTabId;
      const showDash = applyOn && tab.mode === 'dashboard' && id === activeTabId;
      if (tab.atsView) setViewBounds(tab.atsView, showAts ? bounds : hidden);
      if (tab.dashView) setViewBounds(tab.dashView, showDash ? bounds : hidden);
    }
    if (chromeView) {
      if (applyOn) {
        setViewBounds(chromeView, shell.chrome);
        if (restack) raiseView(chromeView);
      } else parkView(chromeView, width, ch);
    }
    if (footerView) {
      if (applyOn) {
        if (restack) raiseView(footerView);
        setViewBounds(footerView, shell.footer);
      } else {
        parkView(footerView, width, fh);
      }
    }
    if (drawerView) {
      if (chatOn) {
        if (restack) raiseView(drawerView);
        setViewBounds(drawerView, shell.drawer);
      } else {
        parkView(drawerView, width, workH);
      }
    }
    if (jobsOn) setViewBounds(sidebarView, shell.sidebar);
    else parkView(sidebarView, shell.sidebar.width, height);
    layoutSplitters(shell, { jobsOn, chatOn });
    if (dockView) parkView(dockView, width, SHELL_TAB_HEIGHT);
    return;
  }
  const bounds = {
    x: 0,
    y: ch,
    width: Math.max(100, width),
    height: Math.max(100, workH - ch - fh),
  };
  const hidden = {
    x: -(bounds.width + 80),
    y: ch,
    width: bounds.width,
    height: bounds.height,
  };
  for (const [id, tab] of tabs) {
    const showAts = applyOn && tab.mode === 'ats' && id === activeTabId;
    const showDash = applyOn && tab.mode === 'dashboard' && id === activeTabId;
    if (tab.atsView) setViewBounds(tab.atsView, showAts ? bounds : hidden);
    if (tab.dashView) setViewBounds(tab.dashView, showDash ? bounds : hidden);
  }
  if (chromeView) {
    if (applyOn) setViewBounds(chromeView, { x: 0, y: 0, width: Math.max(100, width), height: ch });
    else parkView(chromeView, width, ch);
  }
  if (footerView) {
    if (applyOn) {
      if (restack) raiseView(footerView);
      setViewBounds(footerView, {
        x: 0,
        y: Math.max(ch, workH - fh),
        width: Math.max(100, width),
        height: fh,
      });
    } else {
      parkView(footerView, width, fh);
    }
  }
  if (drawerView) {
    if (chatOn) {
      if (restack) raiseView(drawerView);
      setViewBounds(drawerView, { x: 0, y: 0, width, height: workH });
    } else {
      parkView(drawerView, width, workH);
    }
  }
  if (jobsOn) {
    setViewBounds(sidebarView, { x: 0, y: 0, width, height: workH });
  } else {
    parkView(sidebarView, width, workH);
  }
  layoutSplitters(
    {
      splitLeft: { x: 0, y: 0, width: shellLayout.SPLITTER, height: workH },
      splitRight: { x: 0, y: 0, width: shellLayout.SPLITTER, height: workH },
    },
    { jobsOn: false, chatOn: false }
  );
  if (dockView) {
    if (restack) raiseView(dockView);
    setViewBounds(dockView, { x: 0, y: Math.max(0, height - SHELL_TAB_HEIGHT), width, height: SHELL_TAB_HEIGHT });
  }
}

function dashboardUrl(jobUrl) {
  const q = encodeURIComponent(jobUrl || '');
  if (process.env.MAGNET_DEV) return `http://127.0.0.1:5173/?url=${q}`;
  const dist = path.join(__dirname, 'dashboard', 'dist', 'index.html');
  if (fs.existsSync(dist)) return pathToFileURL(dist).href + `?url=${q}`;
  return pathToFileURL(path.join(__dirname, 'dashboard', 'fallback.html')).href + `?url=${q}`;
}

function persistIngestChat() {
  saveChat(INGEST_CHAT_KEY, ingestChat, { company: 'Ingest', title: 'Ingest' });
}

function setupSnapshot() {
  let creds = { clientId: '', clientSecret: '' };
  try {
    creds = credentials() || creds;
  } catch (_) {}
  let resumeCount = 0;
  try {
    persist.open();
    resumeCount = persist.listResumes().length;
  } catch (_) {}
  let storyCount = 0;
  try {
    graph.ensureOpen();
    const row = require('./lib/store').queryOne('SELECT COUNT(*) AS n FROM cards');
    storyCount = Number(row && row.n) || 0;
  } catch (_) {}
  return {
    apiKey: Boolean(String(process.env.CURSOR_API_KEY || '').trim()),
    gmailClientId: Boolean(creds.clientId),
    gmailClientSecret: Boolean(creds.clientSecret),
    gmailConnected: Boolean(gmailConnected()) && !needsModifyConsent(),
    resumeCount,
    storyCount,
    storiesDone: setupGuide.readFlags().storiesDone,
    port: CONTROL_PORT,
  };
}

function ensureSetupWelcome() {
  try {
    const snap = setupSnapshot();
    if (!setupGuide.incomplete(snap)) return;
    if (Array.isArray(ingestChat) && ingestChat.length) return;
    const view = setupGuide.render(snap, { intro: true });
    ingestChat = [{ role: 'magnet', text: view.reply, asks: view.asks, at: Date.now() }];
    persistIngestChat();
  } catch (err) {
    console.warn('[magnet] setup:', (err && err.message) || err);
  }
}

async function importResumeDialog() {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Import resume into JobMagnet',
    properties: ['openFile'],
    filters: [{ name: 'Resume', extensions: ['pdf', 'doc', 'docx'] }],
  });
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
  const abs = picked.filePaths[0];
  const base = path.basename(abs);
  const id = base.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || `resume-${Date.now()}`;
  const resume = persist.importResume({
    id,
    label: base.replace(/\.[^.]+$/, ''),
    filename: base,
    abs,
    isDefault: persist.listResumes().length === 0,
  });
  const tab = activeTabId && tabs.get(activeTabId);
  if (tab) tab.resume = pickResume(tab.meta, resume.id);
  notifyChrome();
  return { ok: true, resume, reply: `Stored ${resume.label} in the vault.` };
}

async function runSetupTurn(text) {
  const action = setupGuide.interpret(text, setupSnapshot());
  const notes = [];
  if (action.note) notes.push(action.note);
  if (action.env) {
    setupGuide.writeEnv(action.env);
    if (action.env.CURSOR_API_KEY) {
      try {
        agentClient.shutdown();
        await agentClient.ensureHost();
      } catch (err) {
        notes.push(`Saved the key. Restart if essays still miss it (${err.message || err}).`);
      }
    }
  }
  if (action.fileStory) {
    try {
      const { applyExperienceUpdates } = require('./lib/employment');
      const patches = await applyExperienceUpdates([action.fileStory], {
        userText: action.fileStory.text,
        source: 'chat',
        heuristic: true,
      });
      const filed = (patches || []).filter((p) => p && p.kind && p.kind !== 'no-op').length;
      const n = setupSnapshot().storyCount;
      notes.push(
        filed
          ? `Filed that under ${action.fileStory.employer}. ${Math.min(n, setupGuide.STORY_GOAL)} of ${setupGuide.STORY_GOAL}.`
          : 'That story was already on file.'
      );
    } catch (err) {
      notes.push(`Could not file that story (${err.message || err}).`);
    }
  }
  if (action.storiesDone) setupGuide.markStoriesDone();
  if (action.needResume) {
    const imported = await importResumeDialog();
    if (imported && imported.cancelled) notes.push('No file chosen.');
    else if (imported && imported.reply) notes.push(imported.reply);
  }
  if (action.needConnect) {
    const connected = await connectGmail();
    if (connected && connected.reply) notes.push(connected.reply);
  }
  const view = setupGuide.render(setupSnapshot());
  const reply = [...notes, view.reply].filter(Boolean).join('\n\n');
  return { ok: true, reply, asks: view.asks || [] };
}

function attachIngestAbort() {
  if (ingestAbort && ingestAbort.signal && !ingestAbort.signal.aborted) return ingestAbort;
  ingestAbort = new AbortController();
  ingestCancelRequested = false;
  return ingestAbort;
}

function ingestWasCancelled(err) {
  return Boolean(
    ingestCancelRequested ||
      (ingestAbort && ingestAbort.signal && ingestAbort.signal.aborted) ||
      (err && err.cancelled)
  );
}

async function cancelIngest() {
  ingestCancelRequested = true;
  if (ingestAbort) {
    try {
      ingestAbort.abort();
    } catch (_) {}
  }
  if (huntState.loginWait) resolveHuntLogin({ skipped: true });
  persistHuntCancel();
  ingestBusy = false;
  notifySidebar();
  notifyChrome();
  try {
    await agentClient.cancel(INGEST_CHAT_KEY);
  } catch (_) {}
  return { ok: true, cancelled: true };
}

function trimChat(list) {
  if (list.length > 40) return list.slice(-40);
  return list;
}

function emptyHuntState() {
  return {
    added: [],
    jobs: [],
    have: new Set(),
    dupes: 0,
    companyHeld: 0,
    jds: 0,
    need: null,
    loginWait: null,
    schema: null,
    starts: [],
    href: '',
    jsonDone: false,
    round: 0,
    last: '',
    status: 'running',
    resumed: false,
  };
}

function huntStore() {
  try {
    persist.open();
    return persist.nodeStore();
  } catch {
    return null;
  }
}

function loadHuntSession() {
  const api = huntStore();
  if (!api || typeof api.getHuntSession !== 'function') return null;
  try {
    return normalizeSession(api.getHuntSession());
  } catch {
    return null;
  }
}

function persistLiveHunt(extra) {
  const api = huntStore();
  if (!api || typeof api.saveHuntSession !== 'function') return null;
  try {
    if (extra === null) {
      api.saveHuntSession(null);
      return null;
    }
    const row = snapshotSession(huntState, extra || {});
    api.saveHuntSession(row);
    return row;
  } catch {
    return null;
  }
}

function currentHuntResume() {
  return resumeHint(loadHuntSession(), lastIngestPlan());
}

function persistHuntCancel() {
  if (huntState.schema || huntState.added.length || huntState.jsonDone || huntState.href || huntState.round) {
    huntState.status = 'cancelled';
    persistLiveHunt({ status: 'cancelled' });
  }
}

function adoptSavedHunt(session) {
  const saved = normalizeSession(session);
  if (!saved || saved.status === 'done') return false;
  huntState = restoreState(saved);
  huntState.resumed = canResume(saved, saved.schema);
  return true;
}

function huntLoginPayload() {
  const wait = huntState && huntState.loginWait;
  if (!wait || !wait.wall) return null;
  return {
    site: wait.wall.site,
    url: wait.wall.url,
    prompt: loginPrompt(wait.wall),
  };
}

function huntPush(text, extra = {}) {
  ingestChat = Array.isArray(ingestChat) ? ingestChat : [];
  ingestChat.push({ role: 'magnet', text, at: Date.now(), ...extra });
  ingestChat = trimChat(ingestChat);
  persistIngestChat();
  notifySidebar();
  notifyChrome();
}

function huntHeldCompanies() {
  const api = huntStore();
  if (!api || typeof api.listJobs !== 'function') return [];
  try {
    return heldCompanyLabels(api.listJobs(), holdBoardFromUrl).slice(0, 80);
  } catch {
    return [];
  }
}

function huntStatus() {
  return {
    ok: true,
    added: huntState.added.length,
    need: huntState.need,
    dupes: huntState.dupes,
    companyHeld: Number(huntState.companyHeld) || 0,
    heldCompanies: huntHeldCompanies(),
    jds: huntState.jds,
    urls: huntState.added.slice(),
    jobs: huntState.jobs.slice(),
    login: huntLoginPayload(),
    jsonDone: Boolean(huntState.jsonDone),
    href: huntState.href || '',
    round: Number(huntState.round) || 0,
    last: huntState.last || '',
    resumed: Boolean(huntState.resumed),
  };
}

function huntMeta(url) {
  return {
    id: HUNT_TAB_ID,
    url: url || 'https://www.linkedin.com/jobs/search/',
    name: 'Hunt',
    title: 'Ingest hunt',
    company: 'Hunt',
    posting: '',
    linkedin: '',
  };
}

function rememberHuntSurface() {
  if (!isHuntTab(activeTabId)) {
    huntReturnTabId = activeTabId;
    huntReturnPane = shellPane;
  }
}

function hideHuntSurface() {
  const tabId = huntReturnTabId;
  const pane = huntReturnPane;
  huntReturnTabId = null;
  huntReturnPane = null;
  if (tabId && !isHuntTab(tabId) && tabs.has(tabId)) {
    activateTab(tabId);
    if (pane) setShellPane(pane);
    return;
  }
  if (isHuntTab(activeTabId)) {
    const next = [...tabs.keys()].find((id) => !isHuntTab(id));
    if (next) activateTab(next);
    else layout();
  }
}

function ensureHuntTab(url) {
  if (!tabs.has(HUNT_TAB_ID)) createTabMeta(huntMeta(url));
  else if (url) {
    const tab = tabs.get(HUNT_TAB_ID);
    tab.meta = { ...tab.meta, ...huntMeta(url) };
    tab.homeUrl = url;
  }
  const tab = tabs.get(HUNT_TAB_ID);
  ensureAtsView(tab);
  if (!isHuntTab(activeTabId)) layout({ restack: false });
  return tab;
}

function waitWcLoad(wc, ms = 14000) {
  if (!wc) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        wc.removeListener('did-finish-load', finish);
      } catch (_) {}
      resolve();
    };
    wc.once('did-finish-load', finish);
    setTimeout(finish, ms);
  });
}

async function huntEval(script) {
  const tab = ensureHuntTab();
  if (!tab.atsView) throw new Error('no hunt view');
  return tab.atsView.webContents.executeJavaScript(script, true);
}

async function huntRawSnapshot() {
  const snap = (await huntEval(snapshotScript())) || {};
  return { ...snap, login: loginWall(snap) };
}

function resolveHuntLogin(result) {
  const wait = huntState.loginWait;
  if (!wait) return false;
  huntState.loginWait = null;
  if (wait.timer) clearTimeout(wait.timer);
  wait.resolve(result || { ok: true });
  hideHuntSurface();
  notifySidebar();
  notifyChrome();
  return true;
}

function huntLoginReply(text) {
  const t = String(text || '').trim();
  if (/skip this site|don'?t have|no account|^\s*skip\b/i.test(t)) return { skipped: true };
  if (/signed in|i'?m in|i am in|\bcontinue\b|checking/i.test(t)) return { signedIn: true };
  return null;
}

async function huntWaitLogin(wall) {
  if (huntState.loginWait) return huntState.loginWait.promise;
  if (huntShowsApply('login')) {
    rememberHuntSurface();
    setShellPane('apply');
    activateTab(HUNT_TAB_ID);
  }
  huntPush(loginPrompt(wall), {
    asks: [
      {
        id: 'hunt-login',
        prompt: loginPrompt(wall),
        options: [
          { id: 'in', label: "I'm signed in" },
          { id: 'skip', label: 'Skip this site' },
        ],
      },
    ],
  });
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  huntState.loginWait = { resolve, promise, wall, timer: null };
  notifyChrome();
  const deadline = Date.now() + 10 * 60 * 1000;
  const tick = async () => {
    if (!huntState.loginWait) return;
    if (Date.now() > deadline) {
      resolveHuntLogin({ skipped: true, reason: 'timeout' });
      return;
    }
    try {
      const snap = await huntRawSnapshot();
      if (!snap.login || !snap.login.login) {
        resolveHuntLogin({ ok: true, signedIn: true, url: snap.url });
        return;
      }
    } catch (_) {}
    huntState.loginWait.timer = setTimeout(tick, 1500);
  };
  tick();
  return promise;
}

async function huntSnapshot() {
  let snap = await huntRawSnapshot();
  if (snap.login && snap.login.login) {
    const waited = await huntWaitLogin(snap.login);
    if (waited && waited.skipped) return { ...snap, skipped: true, ...huntStatus() };
    snap = await huntRawSnapshot();
  }
  return { ...snap, ...huntStatus() };
}

function huntLiveJobs() {
  const api = huntStore();
  if (!api || typeof api.listJobs !== 'function') return [];
  try {
    return api.listJobs();
  } catch {
    return [];
  }
}

async function huntOpen(url) {
  const href = String(url || '').trim();
  if (!href) return { ok: false, error: 'url required' };
  if (listingAlreadyHeld({ url: href }, huntLiveJobs(), holdBoardFromUrl)) {
    const snap = await huntSnapshot();
    return { ...snap, skippedListing: true, text: ALREADY_LISTED };
  }
  const tab = ensureHuntTab(href);
  if (huntShowsApply('open')) activateTab(HUNT_TAB_ID);
  await loadPageUrl(tab.atsView.webContents, href);
  await waitWcLoad(tab.atsView.webContents);
  await new Promise((r) => setTimeout(r, 400));
  huntState.href = href;
  persistLiveHunt({ href });
  return huntSnapshot();
}

async function huntClick(ref) {
  let preview = null;
  try {
    preview = await huntEval(readRefScript(ref));
  } catch (_) {}
  if (preview && preview.ok && listingAlreadyHeld({ url: preview.href, name: preview.name }, huntLiveJobs(), holdBoardFromUrl)) {
    const snap = await huntSnapshot();
    return { ...snap, skippedListing: true, text: ALREADY_LISTED };
  }
  await huntEval(clickScript(ref));
  await new Promise((r) => setTimeout(r, 500));
  return huntSnapshot();
}

async function huntType(ref, text, submit) {
  await huntEval(typeScript(ref, text, submit));
  await new Promise((r) => setTimeout(r, 400));
  return huntSnapshot();
}

async function huntScroll(dir) {
  await huntEval(scrollScript(dir));
  await new Promise((r) => setTimeout(r, 250));
  return huntSnapshot();
}

async function huntWait(ms) {
  await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(200, Number(ms) || 800))));
  return huntSnapshot();
}

async function huntAdd(body) {
  const url = String((body && body.url) || '').trim();
  if (!url) return { ok: false, error: 'url required', ...huntStatus() };
  if (huntState.have.has(url)) {
    huntState.dupes += 1;
    return { ok: false, dupe: true, ...huntStatus() };
  }
  const pasted = String((body && (body.jd || body.jdText)) || '');
  const pastedSource = String((body && body.jdSource) || 'hunt');
  const pastedOk =
    Boolean(pasted) && !isSummarizedJd(pasted) && !/^(hunt|search)$/i.test(pastedSource);
  let captured = null;
  if (!pastedOk) {
    try {
      captured = await expandAbbreviatedJd((script) => huntEval(script), {
        captureJd,
        wait: (ms) => new Promise((r) => setTimeout(r, process.env.NODE_TEST_CONTEXT ? 0 : ms)),
      });
    } catch (_) {}
  }
  const pageText = captured && captured.text ? captured.text : '';
  const pageOk = Boolean(pageText) && !isSummarizedJd(pageText);
  if (!pageOk && !pastedOk) {
    return { ok: false, needJd: true, hint: NEED_FULL_JD_HINT, ...huntStatus() };
  }
  const row = {
    url,
    title: (body && body.title) || '',
    company: (body && body.company) || '',
    posting: (body && body.posting) || url,
    linkedin: (body && body.linkedin) || (/linkedin\.com/i.test(url) ? url : ''),
    location: (body && body.location) || '',
    apply_surface: (body && body.apply_surface) || '',
    apply_cta: (body && body.apply_cta) || null,
    jdText: pageOk ? pageText : pasted,
    jdSource: pageOk ? captured.source || 'host' : pastedSource,
    jd: pageOk ? captured : undefined,
  };
  const r = await appendJobs([row]);
  if (r.added) {
    huntState.have.add(url);
    huntState.added.push(url);
    huntState.jobs.push(row);
    huntState.jds += r.jds || 0;
    reloadJobs();
    huntPush(`Added ${huntState.added.length}/${huntState.need}${row.company ? `: ${row.company}` : ''}`);
  } else if (r.companyHeld) {
    huntState.companyHeld = (Number(huntState.companyHeld) || 0) + r.companyHeld;
    huntState.have.add(url);
    persistLiveHunt();
    const status = huntStatus();
    return { ...status, ok: true, companyHeld: true, company: row.company || '', companyHeldCount: status.companyHeld };
  } else {
    huntState.dupes += 1;
    huntState.have.add(url);
  }
  persistLiveHunt();
  return { ok: true, ...r, dupe: !r.added, ...huntStatus() };
}

async function huntBegin(body) {
  const schema = normalizeSchema(body && body.schema);
  const starts =
    Array.isArray(body && body.starts) && body.starts.length ? body.starts : huntStartUrls(schema);
  const saved = loadHuntSession();
  const resume = Boolean(body && body.resume) && canResume(saved, schema);
  if (!(Number(schema.n) >= 1) && !resume) {
    return { ok: false, missingCount: true, ...huntStatus() };
  }
  if (resume) {
    huntState = restoreState(saved);
    huntState.need = saved.need || schema.n;
    huntState.schema = schema;
    huntState.starts = saved.starts && saved.starts.length ? saved.starts : starts;
    huntState.status = 'running';
    huntState.resumed = true;
    persistLiveHunt({ schema, starts: huntState.starts, status: 'running' });
    return huntStatus();
  }
  huntState = emptyHuntState();
  huntState.need = schema.n;
  huntState.schema = schema;
  huntState.starts = starts;
  persistLiveHunt({ schema, starts, status: 'running' });
  if (!body.deferOpen && starts[0] && starts[0].url) await huntOpen(starts[0].url);
  return huntStatus();
}

async function huntOp(op, body) {
  if (op === 'begin') return huntBegin(body || {});
  if (op === 'open') return huntOpen(body && body.url);
  if (op === 'snapshot') return huntSnapshot();
  if (op === 'click') return huntClick(body && body.ref);
  if (op === 'type') return huntType(body && body.ref, body && body.text, body && body.submit);
  if (op === 'scroll') return huntScroll(body && body.dir);
  if (op === 'wait') return huntWait(body && body.ms);
  if (op === 'add') return huntAdd(body || {});
  if (op === 'sign-in') {
    const wall = loginWall({ url: (body && body.url) || '', title: body && body.site });
    if (body && body.site) wall.site = body.site;
    if (body && body.url) wall.url = body.url;
    wall.login = true;
    const out = await huntWaitLogin(wall);
    return { ...(out || {}), ...huntStatus() };
  }
  if (op === 'status') return huntStatus();
  if (op === 'progress') {
    if (body) {
      if (body.jsonDone != null) huntState.jsonDone = Boolean(body.jsonDone);
      if (body.round != null) huntState.round = Math.max(0, Number(body.round) || 0);
      if (body.last != null) huntState.last = String(body.last);
      if (body.href != null) huntState.href = String(body.href);
      if (body.status) huntState.status = String(body.status);
    }
    persistLiveHunt();
    return huntStatus();
  }
  if (op === 'note') {
    if (body && body.text) huntPush(String(body.text));
    return huntStatus();
  }
  return { ok: false, error: `unknown hunt op ${op}` };
}

function chromePayload(tab) {
  const status = (tab && tab.meta && tab.meta.status) || 'open';
  const apply = tab
    ? {
        ...tab.meta,
        status,
        bucket: filterBucket(status),
        autofillStatus: tab.autofillStatus,
        autofillStep: tab.autofillStep,
        autofillDetail: tab.autofillDetail || '',
        essayBusy: Boolean(tab.essayBusy),
        runKind: tab.runKind || '',
        essayError: tab.essayError || '',
        mode: tab.mode || '',
        ats: tab.ats,
        resume: tab.resume,
        resumes: loadResumes().map((r) => ({ id: r.id, label: r.label })),
        resumeUploaded: tab.resumeUploaded,
        sessionSubmitted: sessionCounts.submitted,
        sessionPassed: sessionCounts.passed,
        sessionRejected: sessionCounts.rejected,
        model: models.snapshot(appSettings),
        huntLogin: huntLoginPayload(),
        strategyCache: cacheSnapshot(),
      }
    : {
        id: null,
        chat: [],
        model: models.snapshot(appSettings),
        huntLogin: huntLoginPayload(),
        strategyCache: cacheSnapshot(),
        sessionSubmitted: sessionCounts.submitted,
        sessionPassed: sessionCounts.passed,
        sessionRejected: sessionCounts.rejected,
      };
  return { ...apply, ...conversationOverlay(tab) };
}

function notifyChrome() {
  const tab = activeTabId && tabs.get(activeTabId);
  const payload = chromePayload(tab);
  if (chromeView) chromeView.webContents.send('magnet:chrome', payload);
  if (footerView) footerView.webContents.send('magnet:chrome', payload);
  if (drawerView) drawerView.webContents.send('magnet:chrome', payload);
  const conv = payload && payload.conversation;
  const match = tab && conv && conv.applyMatches;
  const targetId = match && payload.chatTarget && payload.chatTarget.id;
  if (tab && tab.atsView && tab.atsView.webContents) {
    evalFirstOk(tab.atsView.webContents, chatTargetScript(targetId || '')).catch(() => {});
  }
}

function ensureFooterView() {
  if (footerView || !mainWindow) return footerView;
  footerView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-chrome.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.addBrowserView(footerView);
  footerView.webContents.loadFile(path.join(__dirname, 'chrome', 'index.html'), { hash: 'footer' });
  wireFlaggingKeys(footerView.webContents);
  footerView.webContents.on('did-finish-load', () => notifyChrome());
  return footerView;
}

function ensureDrawerView() {
  if (drawerView || !mainWindow) return drawerView;
  drawerView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-chrome.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.addBrowserView(drawerView);
  drawerView.webContents.loadFile(path.join(__dirname, 'chrome', 'index.html'), { hash: 'drawer' });
  wireFlaggingKeys(drawerView.webContents);
  drawerView.webContents.on('did-finish-load', () => {
    drawerView.webContents.send('magnet:drawer-mode', drawerTab);
    notifyChrome();
  });
  return drawerView;
}

function ensureDockView() {
  if (dockView || !mainWindow) return dockView;
  dockView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-chrome.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.addBrowserView(dockView);
  dockView.webContents.loadFile(path.join(__dirname, 'chrome', 'index.html'), { hash: 'dock' });
  dockView.webContents.on('did-finish-load', () => notifyShellPane());
  return dockView;
}

function ensureSplitterViews() {
  if (!mainWindow) return;
  const prefs = {
    preload: path.join(__dirname, 'preload-splitter.js'),
    contextIsolation: true,
    nodeIntegration: false,
  };
  if (!splitLeft) {
    splitLeft = new BrowserView({ webPreferences: prefs });
    splitLeft.setBackgroundColor('#00000000');
    mainWindow.addBrowserView(splitLeft);
    splitLeft.webContents.loadFile(path.join(__dirname, 'chrome', 'splitter.html'), { hash: 'sidebar' });
  }
  if (!splitRight) {
    splitRight = new BrowserView({ webPreferences: prefs });
    splitRight.setBackgroundColor('#00000000');
    mainWindow.addBrowserView(splitRight);
    splitRight.webContents.loadFile(path.join(__dirname, 'chrome', 'splitter.html'), { hash: 'drawer' });
  }
}

function bumpCount(kind) {
  lifetimeTotals = bump(kind);
  if (sessionCounts[kind] != null) sessionCounts[kind] += 1;
  return lifetimeTotals;
}

function unbumpCount(kind) {
  lifetimeTotals = unbump(kind);
  if (sessionCounts[kind] != null) sessionCounts[kind] = Math.max(0, sessionCounts[kind] - 1);
  return lifetimeTotals;
}

function ingestStatePayload() {
  return {
    ingestOpen,
    ingestChat,
    ingestBusy,
    ingestPlan,
    huntLogin: huntLoginPayload(),
    huntResume: currentHuntResume(),
  };
}

function lastIngestPlan() {
  const list = Array.isArray(ingestChat) ? ingestChat : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] && list[i].plan) return list[i].plan;
  }
  return ingestPlan;
}

function tabAsJob(tab, rec) {
  const record = rec || null;
  const status = (record && record.status) || (tab.meta && tab.meta.status) || statusOf(tab.meta.url);
  return {
    ...tab.meta,
    status,
    bucket: filterBucket(status),
    ai: Boolean((tab.meta && (tab.meta.ai || tab.meta.agent)) || (record && record.ai)),
    updatedAt: sidebarFilters.updatedAt(tab.meta, record || tab.meta),
  };
}

function sidebarBriefs() {
  return null;
}

function sidebarListPayload() {
  const open = [...tabs.values()].filter((tab) => tab.meta.id !== HUNT_TAB_ID);
  const briefs = sidebarBriefs(open.map((tab) => tab.meta.url));
  return {
    tabs: open.map((tab) => ({
      ...tabAsJob(tab, briefs ? briefs.get(tab.meta.url) : undefined),
      active: tab.meta.id === activeTabId,
      autofillStatus: tab.autofillStatus,
    })),
    filters: sidebarFilter,
    tabsPending: tabBoot && !tabBoot.done ? tabBoot.pending.length : 0,
    activeTabId,
    controlPort: CONTROL_PORT,
    totals: lifetimeTotals,
    session: sessionCounts,
    notices: sidebarNotices(),
    ...ingestStatePayload(),
  };
}

function notifySidebar() {
  if (!sidebarView) return;
  sidebarView.webContents.send('magnet:tabs', sidebarListPayload());
  notifyNavState();
  notifyChrome();
}

function activeWc() {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab || tab.mode !== 'ats' || !tab.atsView) return null;
  return tab.atsView.webContents;
}

function notifyNavState() {
  if (!sidebarView) return;
  const wc = activeWc();
  sidebarView.webContents.send('magnet:nav', {
    canGoBack: wc ? wc.navigationHistory?.canGoBack?.() ?? wc.canGoBack() : false,
    canGoForward: wc ? wc.navigationHistory?.canGoForward?.() ?? wc.canGoForward() : false,
    url: wc ? wc.getURL() : '',
  });
}

function toast(message, extra) {
  const payload = message && typeof message === 'object' ? message : { message: message || '', ...(extra || {}) };
  if (chromeView) chromeView.webContents.send('magnet:toast', payload);
  if (footerView) footerView.webContents.send('magnet:toast', payload);
}

function settleOutcomeUndo({ destroy = true } = {}) {
  const pending = pendingOutcome;
  if (!pending) return;
  pendingOutcome = null;
  clearTimeout(pending.timer);
  const tab = tabs.get(pending.id);
  if (destroy && tab && tab.mode !== 'ats') destroyAts(tab);
  if (pending.debrief && tab && tab.debrief) {
    startDebrief(tab).catch((err) => console.warn('[magnet] voice debrief:', (err && err.message) || err));
  }
  if (pending.congrats) congratsCheck(pending.congrats);
  layout();
}

function armOutcomeUndo({ id, kind, snap, name, detail, congrats, debrief }) {
  settleOutcomeUndo();
  const holdMs = outcomeUndo.HOLD_MS;
  pendingOutcome = {
    id,
    kind,
    url: tabs.get(id) && tabs.get(id).meta.url,
    snap,
    congrats: congrats || '',
    debrief: Boolean(debrief),
    timer: setTimeout(() => settleOutcomeUndo(), holdMs),
  };
  toast(outcomeUndo.toastPayload({ kind, name, detail, holdMs }));
  layout();
}

function undoOutcome() {
  const pending = pendingOutcome;
  if (!pending) return { ok: false };
  pendingOutcome = null;
  clearTimeout(pending.timer);
  const rec = getRecord(pending.url);
  writeJobRecord(pending.url, outcomeUndo.revertRecord(rec, outcomeUndo.eventTypeOf(pending.kind), pending.snap));
  unbumpCount(outcomeUndo.countKind(pending.kind));
  const tab = tabs.get(pending.id);
  if (tab) {
    tab.debrief = null;
    tab.autofillDetail = '';
    if (pending.kind === 'complete' || pending.kind === 'pass') tab.mode = 'ats';
  }
  toast({ hide: true });
  if (tab && (pending.kind === 'complete' || pending.kind === 'pass')) activateTab(pending.id);
  else {
    notifySidebar();
    notifyDash();
    notifyChrome();
    layout();
  }
  return { ok: true };
}

function focusUrlBar() {
  urlCopyArmed = true;
  if (!sidebarView) return;
  try {
    if (mainWindow) mainWindow.focus();
  } catch (_) {}
  sidebarView.webContents.focus();
  sidebarView.webContents.send('magnet:url-focus');
}

function setFlagging(on) {
  const next = Boolean(on);
  if (flagging === next) return;
  flagging = next;
  const tab = activeTabId && tabs.get(activeTabId);
  if (tab && tab.atsView) {
    tab.atsView.webContents
      .executeJavaScript(`window.__magnetSetFlagging && window.__magnetSetFlagging(${next})`)
      .catch(() => {});
  }
  if (chromeView) chromeView.webContents.send('magnet:flagging', next);
  if (footerView) footerView.webContents.send('magnet:flagging', next);
  if (drawerView) drawerView.webContents.send('magnet:flagging', next);
}

function wireFlaggingKeys(wc) {
  if (!wc || wc.__magnetFlagKeys) return;
  wc.__magnetFlagKeys = true;
  wc.on('before-input-event', (_event, input) => {
    if (input.key !== 'Control') return;
    setFlagging(input.type === 'keyDown');
  });
  wc.on('blur', () => setFlagging(false));
}

function attachAtsHandlers(tab, view) {
  wireFlaggingKeys(view.webContents);
  const popupPrefs = { partition: SHARED_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true };
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isAuthPopupUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 560, height: 740, webPreferences: popupPrefs } };
    }
    if (url && url !== 'about:blank') {
      loadPageUrl(view.webContents, unwrapNavigationUrl(url));
      return { action: 'deny' };
    }
    return { action: 'allow', overrideBrowserWindowOptions: { show: false, webPreferences: popupPrefs } };
  });
  view.webContents.on('did-navigate', () => notifyNavState());
  view.webContents.on('did-navigate-in-page', () => notifyNavState());
  view.webContents.on('did-finish-load', () => {
    view.webContents.executeJavaScript(FLAG_SCRIPT).catch(() => {});
  });
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    const key = (input.key || '').toLowerCase();
    if (mod && key === 'l') {
      event.preventDefault();
      focusUrlBar();
    }
    if (mod && key === 'c' && urlCopyArmed) {
      event.preventDefault();
      clipboard.writeText(view.webContents.getURL() || '');
      urlCopyArmed = false;
      toast('Copied URL');
    }
    if (urlCopyArmed && key !== 'c' && key !== 'l' && key !== 'meta' && key !== 'control' && !mod) {
      urlCopyArmed = false;
    }
    if (mod && key === 'd') {
      event.preventDefault();
      if (tab.autofillStatus === 'running') cancelFillJob(tab.meta.id);
      else startAutofill(tab.meta.id);
    }
    if (mod && key === 'e') {
      event.preventDefault();
      startEssays(tab.meta.id);
    }
    if (mod && key === 'u') {
      event.preventDefault();
      startUploadResume(tab.meta.id);
    }
    if (mod && key === 'r' && !input.shift) {
      event.preventDefault();
      view.webContents.reload();
    }
    if (mod && key === '[') {
      event.preventDefault();
      if (view.webContents.canGoBack()) view.webContents.goBack();
    }
    if (mod && key === ']') {
      event.preventDefault();
      if (view.webContents.canGoForward()) view.webContents.goForward();
    }
    if (mod && (key === '=' || key === '+')) {
      event.preventDefault();
      view.webContents.setZoomLevel(view.webContents.getZoomLevel() + 0.5);
    }
    if (mod && key === '-') {
      event.preventDefault();
      view.webContents.setZoomLevel(view.webContents.getZoomLevel() - 0.5);
    }
    if (key === 'escape') {
      if (view.webContents.isLoading()) {
        event.preventDefault();
        view.webContents.stop();
      }
    }
  });
}

function ensureAtsView(tab, opts = {}) {
  const created = !tab.atsView;
  if (tab.atsView) return tab.atsView;
  const view = new BrowserView({
    webPreferences: {
      partition: SHARED_PARTITION,
      preload: path.join(__dirname, 'preload-ats.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  view.webContents.setUserAgent(CHROME_UA);
  attachAtsHandlers(tab, view);
  mainWindow.addBrowserView(view);
  tab.atsView = view;
  if (created) ensureJobChat(tab);
  if (!opts.deferLoad) loadPageUrl(view.webContents, tab.homeUrl);
  return view;
}

function ensureDashView(tab, opts = {}) {
  if (tab.dashView) return tab.dashView;
  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-dashboard.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.addBrowserView(view);
  tab.dashView = view;
  if (!opts.deferLoad) view.webContents.loadURL(dashboardUrl(tab.meta.url));
  return view;
}

function destroyAts(tab) {
  if (!tab.atsView || !mainWindow) return;
  try {
    mainWindow.removeBrowserView(tab.atsView);
  } catch (_) {}
  try {
    tab.atsView.webContents.destroy();
  } catch (_) {}
  tab.atsView = null;
}

function showMode(tab, mode) {
  tab.mode = mode;
  const created = mode === 'ats' ? !tab.atsView : !tab.dashView;
  if (mode === 'ats') ensureAtsView(tab, { deferLoad: created });
  else ensureDashView(tab, { deferLoad: created });
  layout({ restack: created });
  if (created && mode === 'ats' && tab.atsView) {
    loadPageUrl(tab.atsView.webContents, tab.homeUrl);
  } else if (created && tab.dashView) {
    tab.dashView.webContents.loadURL(dashboardUrl(tab.meta.url));
  }
}

const BOOT_TABS = 12;
const SIDEBAR_BATCH = 24;
let tabBoot = null;
let bootGen = 0;

function shellTab(meta) {
  if (!meta || !meta.id || tabs.has(meta.id)) return tabs.get(meta && meta.id);
  const status = meta.status || 'open';
  const tab = {
    meta: { ...meta, status },
    homeUrl: meta.url,
    atsView: null,
    dashView: null,
    mode: !status || status === 'open' ? 'ats' : 'dashboard',
    autofillStatus: 'idle',
    autofillStep: '',
    autofillDetail: '',
    runKind: '',
    lastLlm: null,
    lastReview: null,
    review: null,
    reviewFocus: '',
    reviewFlashId: '',
    reviewFlashAt: 0,
    focusedFieldId: '',
    skippedReview: false,
    reviewNotes: [],
    reviewCounts: { proposed: 0, accepted: 0, harvested: 0 },
    fillRecord: null,
    reviewFieldChats: {},
    chat: [],
    chatFolded: [],
    agentId: '',
    agentSnapshotKey: '',
    pageSubtab: 'chat',
    jd: null,
    debugFields: [],
    resume: null,
    resumeOverride: null,
    resumeUploaded: false,
    essaySession: null,
    hydrated: false,
  };
  tabs.set(meta.id, tab);
  const key = chatKeyOfTab(tab);
  if (chatTabs.isJobKey(key)) chatUi = chatTabs.normalizeUi(chatTabs.ensureTab(chatUi, key));
  return tab;
}

function applyHydration(tab, detail) {
  const chat = (detail && detail.chat) || {};
  tab.chat = chat.messages || [];
  tab.chatFolded = chat.folded || [];
  tab.agentId = chat.agentId || '';
  tab.agentSnapshotKey = chat.snapshotKey || '';
  if (chat.pageSubtab && !tab.pageChosen) tab.pageSubtab = chatTabs.asPageSubtab(chat.pageSubtab);
  const rec = detail && detail.process;
  tab.process = rec || null;
  if (rec && rec.jd) tab.jd = rec.jd;
  if (rec && rec.status) tab.meta.status = rec.status;
  tab.hydrated = true;
  tab.hydrating = false;
  if (activeTabId === tab.meta.id) {
    notifyChrome();
    if (tab.dashView) tab.dashView.webContents.send('magnet:process', processPayload(tab));
  }
}

function hydrateTab(tab) {
  if (!tab || tab.hydrated || tab.hydrating || isHuntTab(tab.meta && tab.meta.id)) return;
  if (!tab.essaySession) tab.essaySession = loadSession(tab.meta.id);
  tab.hydrating = true;
  const id = tab.meta.id;
  const done = (detail) => {
    const current = tabs.get(id);
    if (!current) return;
    applyHydration(current, detail);
  };
  const fail = (err) => {
    const current = tabs.get(id);
    if (current) current.hydrating = false;
    console.warn('[magnet] tab:', (err && err.message) || err);
  };
  if (!require('./lib/store/mode').isSupabase()) {
    setImmediate(() => {
      try {
        done({ chat: loadChatState(tab.meta.url), process: getRecord(tab.meta.url) });
      } catch (err) {
        fail(err);
      }
    });
    return;
  }
  persist
    .nodeStore()
    .loadTabDetail(tab.meta.url)
    .then(done)
    .catch(fail);
}

function createTabMeta(meta) {
  return shellTab(meta);
}

function activateStep(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[magnet] activate', label + ':', (err && err.stack) || err);
    return undefined;
  }
}

function activateTab(id) {
  const tab = tabs.get(id);
  if (!tab) return false;
  activateStep('hydrate', () => hydrateTab(tab));
  const switching = activeTabId !== id;
  activeTabId = id;
  const status = (tab.meta && tab.meta.status) || '';
  const open = !status || status === 'open';
  if (switching) activateStep('timing', () => timing.activate(tab, { open }));
  if (isCompactLayout()) activateStep('pane', () => setShellPane('apply', { relayout: false }));
  activateStep('chat', () => ensureJobChat(tab));
  if (id !== HUNT_TAB_ID && !chatTabs.isIngest(activeChatKey())) {
    activateStep('ui', () => {
      persistUi(chatTabs.selectTab(chatUi, chatKeyOfTab(tab)));
      tab.pageSubtab = chatTabs.asPageSubtab(tab.pageSubtab || drawerTab);
      drawerTab = tab.pageSubtab;
    });
  }
  activateStep('sidebar', () => notifySidebar());
  activateStep('show', () => showMode(tab, open ? 'ats' : tab.mode === 'ats' ? 'ats' : 'dashboard'));
  if (open) activateStep('ats', () => ensureAtsView(tab));
  else activateStep('dash', () => ensureDashView(tab));
  if (tab.dashView) activateStep('process', () => tab.dashView.webContents.send('magnet:process', processPayload(tab)));
  activateStep('chrome', () => notifyChrome());
  activateStep('hydrate2', () => hydrateTab(tab));
  return true;
}

function listedJobIds(extra = {}) {
  const open = [...tabs.values()].filter((tab) => !isHuntTab(tab.meta.id));
  const briefs = sidebarBriefs(open.map((tab) => tab.meta.url));
  return sidebarFilters
    .apply(
      open.map((tab) => tabAsJob(tab, briefs ? briefs.get(tab.meta.url) : undefined)),
      { ...sidebarFilter, ...extra }
    )
    .map((job) => job.id);
}

function nextOpenTabId(fromId) {
  const ids = listedJobIds({ status: 'all' }).filter((id) => {
    const tab = tabs.get(id);
    return tab && isOpen(tab.meta.url);
  });
  const next = cycleList(ids, fromId, 1);
  return next && next !== fromId ? next : null;
}

function visibleJobIds() {
  return listedJobIds();
}

function cycleList(ids, current, dir) {
  if (!ids.length) return null;
  let i = ids.indexOf(current);
  if (i === -1) i = dir > 0 ? -1 : 0;
  return ids[(i + dir + ids.length) % ids.length];
}

function focusActiveJobView() {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab) return;
  const view = tab.mode === 'dashboard' ? tab.dashView : tab.atsView;
  if (!view) return;
  try {
    view.webContents.focus();
  } catch (_) {}
}

function cycleJobTab(dir, fromWc) {
  const next = cycleList(visibleJobIds(), activeTabId, dir);
  if (!next) return false;
  const switched = next !== activeTabId;
  if (switched) activateTab(next);
  if (
    (sidebarView && fromWc === sidebarView.webContents) ||
    (chromeView && fromWc === chromeView.webContents) ||
    (footerView && fromWc === footerView.webContents) ||
    (dockView && fromWc === dockView.webContents)
  ) {
    try {
      fromWc.focus();
    } catch (_) {}
    return Boolean(switched);
  }
  if (switched) focusActiveJobView();
  return Boolean(switched);
}

function cycleDrawerTab(dir, opts = {}) {
  if (!chatTabs.pageRailVisible(activeChatKey())) return;
  const order = chatTabs.pageTabs(appSettings && appSettings.handedness);
  const next = cycleList(order, drawerTab, dir);
  if (!next || next === drawerTab) return;
  const tab = tabByChatKey(activeChatKey());
  if (tab) selectJobPage(tab, next);
  else openDrawer(next);
  if (opts.focus === false || !drawerView) return;
  try {
    drawerView.webContents.focus();
  } catch (_) {}
}

function isChatFocused(wc) {
  return Boolean(drawerView && wc === drawerView.webContents);
}

function handleCtrlTab(event, input, wc) {
  if (input.type !== 'keyDown') return false;
  if (!input.control || input.meta || input.alt) return false;
  if (String(input.key || '').toLowerCase() !== 'tab') return false;
  event.preventDefault();
  const dir = input.shift ? -1 : 1;
  const chatFocused = isChatFocused(wc);
  if (settings.ctrlTabTarget(appSettings, chatFocused) === 'job') cycleJobTab(dir, wc);
  else cycleDrawerTab(dir, { focus: chatFocused });
  return true;
}

function advanceAfterClose(fromId) {
  const nextId = nextOpenTabId(fromId);
  if (nextId) {
    activateTab(nextId);
    return true;
  }
  const tab = tabs.get(fromId);
  if (tab) {
    tab.mode = 'dashboard';
    ensureDashView(tab);
  }
  layout();
  notifySidebar();
  return false;
}

function shownProcess(tab) {
  const process = { ...(tab.process || { status: (tab.meta && tab.meta.status) || 'open', events: [] }) };
  const status = (tab.meta && tab.meta.status) || process.status || 'open';
  const row = submissionByUrl(tab.meta.url);
  if (process.status !== status) process.status = status;
  if (row && status === 'submitted' && !process.submitted_at) process.submitted_at = row.submitted_at || null;
  if (row && !(process.events || []).some((event) => event.type === 'submitted')) {
    process.events = [
      ...(process.events || []),
      {
        at: row.submitted_at || new Date().toISOString(),
        type: 'submitted',
        title: 'Applied',
        body: 'Daily apply run',
        contact_id: null,
        deleted: false,
      },
    ];
  }
  return process;
}

function processPayload(tab) {
  const process = shownProcess(tab);
  return {
    job: {
      ...tab.meta,
      posting: tab.meta.posting || process.posting || tab.meta.linkedin || '',
    },
    process,
    mode: tab.mode,
    mail: mailForJob(tab.meta.url, tab.meta.company || tab.meta.name),
  };
}

function notifyDash() {
  const tab = activeTabId && tabs.get(activeTabId);
  if (tab && tab.dashView) tab.dashView.webContents.send('magnet:process', processPayload(tab));
}

function gmailPrefs(show) {
  return {
    show: show !== false,
    width: 520,
    height: 720,
    title: 'Sign in to Gmail',
    backgroundColor: '#12141a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: SHARED_PARTITION,
    },
  };
}

function loadGmailWin(win, url) {
  win.webContents.setUserAgent(CHROME_UA);
  win.loadURL(url);
}

function waitLoaded(wc) {
  return new Promise((resolve) => {
    if (wc.isLoading && !wc.isLoading()) return resolve();
    wc.once('did-finish-load', () => resolve());
    setTimeout(resolve, 8000);
  });
}

function gmailWaitHtml() {
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html>
<html><body style="margin:0;font:15px/1.45 -apple-system,sans-serif;background:#12141a;color:#e8eaed;padding:28px 24px">
<p style="margin:0 0 8px;font-weight:600">Finish Google sign-in in your browser</p>
<p style="margin:0;color:#9aa0a6">Allow mailbox changes so Magnet can archive rejections and application receipts out of your inbox. This window closes when Magnet is connected. Close it to cancel.</p>
</body></html>`)
  );
}

async function connectGmail() {
  const email = signedInEmail();
  if (gmailConnected() && !needsModifyConsent()) {
    try {
      const token = await accessToken();
      if (token) {
        const result = {
          ok: true,
          connected: true,
          email,
          reply: email ? `Signed in as ${email}.` : 'Signed in to Gmail.',
        };
        notifyDash();
        return result;
      }
    } catch (err) {
      console.warn('[magnet] gmail connect', (err && err.message) || err);
    }
  }
  if (!oauthReady()) {
    return Promise.resolve({
      ok: false,
      reply:
        `Google will not sign in inside Magnet. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to .env (Desktop OAuth client, redirect ${setupGuide.redirectUri({ port: CONTROL_PORT })}), then say connect gmail again.`,
    });
  }
  const oauth = authUrl({ email, forceConsent: true });
  if (!oauth) {
    return Promise.resolve({ ok: false, reply: 'Could not build the Google sign-in URL.' });
  }
  const win = new BrowserWindow({
    ...gmailPrefs(true),
    width: 440,
    height: 200,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.loadURL(gmailWaitHtml());
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (oauthWait && oauthWait.finish === finish) oauthWait = null;
      clearTimeout(timer);
      try {
        if (!win.isDestroyed()) win.close();
      } catch (_) {}
      notifyDash();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reply: 'Gmail sign-in timed out.' }), 5 * 60 * 1000);
    oauthWait = { finish };
    win.on('closed', () => {
      if (!settled && gmailConnected()) {
        const who = signedInEmail();
        finish({ ok: true, connected: true, email: who, reply: who ? `Signed in as ${who}.` : 'Signed in to Gmail.' });
      } else if (!settled) {
        finish({ ok: false, reply: 'Gmail sign-in closed.' });
      }
    });
    shell.openExternal(oauth).catch((err) => {
      finish({ ok: false, reply: String(err.message || err) });
    });
  });
}

async function handleOAuthCallback(query) {
  if (query.error) {
    const result = { ok: false, reply: String(query.error) };
    if (oauthWait) oauthWait.finish(result);
    return result;
  }
  if (!query.code) {
    const result = { ok: false, reply: 'Missing OAuth code.' };
    if (oauthWait) oauthWait.finish(result);
    return result;
  }
  try {
    await exchangeCode(query.code);
    const who = signedInEmail();
    const result = {
      ok: true,
      connected: true,
      email: who,
      reply: who ? `Signed in as ${who}.` : 'Signed in to Gmail.',
    };
    if (oauthWait) oauthWait.finish(result);
    return result;
  } catch (err) {
    const result = { ok: false, reply: String(err.message || err) };
    if (oauthWait) oauthWait.finish(result);
    return result;
  }
}

async function fetchGmailWebMessages(index) {
  const win = new BrowserWindow({ ...gmailPrefs(false), show: false });
  try {
  loadGmailWin(win, searchUrl());
  await waitLoaded(win.webContents);
  await new Promise((r) => setTimeout(r, 2500));
  if (!inboxUrl(win.webContents.getURL())) {
    try {
      win.destroy();
    } catch (_) {}
    throw new Error('Gmail session expired — sign in again.');
  }
  let ids = [];
  try {
    ids = (await win.webContents.executeJavaScript(THREAD_IDS_JS)) || [];
  } catch (_) {
    ids = [];
  }
  const cache = new Map();
  const getMessage = async (id) => {
    if (cache.has(id)) return cache.get(id);
    if (index[id] && index[id].verdict && !index[id].keep_body) return null;
    loadGmailWin(win, printUrl(id));
    await waitLoaded(win.webContents);
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
    const msg = parsePrintView(html, id);
    cache.set(id, msg);
    return msg;
  };
  const fresh = ids.filter((id) => !index[id] || !index[id].verdict);
  getMessage._close = () => {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch (_) {}
  };
  return { ids: fresh, getMessage };
  } catch (err) {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch (_) {}
    throw err;
  }
}

async function runMailScan() {
  if (!gmailConnected()) {
    const signed = await connectGmail();
    if (!signed.ok) return signed;
  }
  let webFetch = null;
  try {
    const out = await scanInbox({
      listWebMessages: async (index) => {
        webFetch = await fetchGmailWebMessages(index);
        return webFetch;
      },
    });
    for (let i = 0; i < (out.autoRejected || []).length; i += 1) bumpCount('rejected');
    notifyUnsureMail(out.notify);
    notifyMail(out.notify);
    notifySidebar();
    notifyDash();
    return out;
  } finally {
    if (webFetch && webFetch.getMessage && webFetch.getMessage._close) webFetch.getMessage._close();
  }
}

async function webCodeMessages({ company, since }) {
  const win = new BrowserWindow({ ...gmailPrefs(false), show: false });
  try {
    const loadIds = async (query) => {
      loadGmailWin(win, searchUrl(query));
      await waitLoaded(win.webContents);
      await new Promise((r) => setTimeout(r, 2500));
      if (!inboxUrl(win.webContents.getURL())) return null;
      try {
        return (await win.webContents.executeJavaScript(THREAD_IDS_JS)) || [];
      } catch (_) {
        return [];
      }
    };
    let ids = await loadIds(codeQuery({ company, since }));
    if (ids == null) {
      return {
        error:
          'Gmail is not signed in. Connect the mailbox with node agent-ctl.js mail-connect, then ask for the code again.',
      };
    }
    if (!ids.length && company) ids = (await loadIds(codeQuery({ since }))) || [];
    const messages = [];
    for (const id of ids.slice(0, 4)) {
      loadGmailWin(win, printUrl(id));
      await waitLoaded(win.webContents);
      const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
      messages.push(parsePrintView(html, id));
    }
    return messages;
  } finally {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch (_) {}
  }
}

async function findMailVerificationCode(body) {
  const since = (body && body.since) || new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const company = (body && body.company) || '';
  const gaps = [0, 8000, 11000, 14000, 18000, 22000];
  let signedOut = '';
  for (let attempt = 0; attempt < gaps.length; attempt += 1) {
    if (gaps[attempt]) {
      const jitter = 1500 + Math.floor(Math.random() * 2500);
      await new Promise((r) => setTimeout(r, gaps[attempt] + jitter));
    }
    let messages = [];
    let via = '';
    let token = null;
    let tokenError = '';
    try {
      token = await accessToken();
    } catch (err) {
      tokenError = String((err && err.message) || err);
      console.warn('[magnet] gmail code', tokenError);
    }
    if (!token && /invalid_grant|expired|bad request/i.test(tokenError)) {
      return {
        ok: false,
        code: '',
        reply:
          'Gmail refresh token was rejected (' +
          tokenError +
          '). Replace GMAIL_REFRESH_TOKEN with one line from the same Desktop client, then stop. Do not continue the run.',
      };
    }
    if (token) {
      via = 'gmail-api';
      try {
        messages = await fetchGmailCodeMessages(token, { company, since });
        if (!messages.length && company) messages = await fetchGmailCodeMessages(token, { since });
      } catch (err) {
        console.warn('[magnet] gmail code', err.message || err);
        messages = [];
      }
    } else {
      via = 'gmail-web';
      const web = await webCodeMessages({ company, since });
      if (web && web.error) {
        signedOut = web.error;
        break;
      }
      messages = Array.isArray(web) ? web : [];
    }
    const hit = pickVerificationCode(messages, { company, since });
    if (hit) return { ok: true, via, ...hit };
  }
  if (signedOut) return { ok: false, code: '', reply: signedOut };
  return { ok: false, code: '', reply: 'No verification code in the mailbox yet.' };
}

function signOutGmail() {
  gmailSignOut();
  notifyDash();
  return { ok: true, connected: false, email: '', reply: 'Signed out of Gmail.' };
}

function applyMailResolves(out) {
  for (let i = 0; i < (out.rejected || []).length; i += 1) bumpCount('rejected');
  notifySidebar();
  notifyDash();
  return out;
}

function congratsCheck(kind) {
  if (kind === 'submitted') {
    if (sessionCounts.submitted % 10 === 0 && sessionCounts.submitted > 0) {
      toast(`Congrats! ${sessionCounts.submitted} this session`);
    }
    const life = lifetimeTotals.submitted;
    if (life % 50 === 0 && life > 0) toast(`Congrats! ${life} lifetime submits`);
  }
}

const harvestTimers = new Map();

function urlsMatch(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  if (left === right) return true;
  try {
    const { canonicalUrl } = require('./lib/job-identity');
    return canonicalUrl(left) === canonicalUrl(right);
  } catch (_) {
    return false;
  }
}

function findTabByUrl(url) {
  return [...tabs.values()].find((tab) => tab && tab.meta && urlsMatch(tab.meta.url, url)) || null;
}

function scheduleHarvest(tab, delay = 1500) {
  if (!tab || !tab.meta || !tab.meta.id) return;
  const id = tab.meta.id;
  clearTimeout(harvestTimers.get(id));
  harvestTimers.set(
    id,
    setTimeout(() => {
      harvestTimers.delete(id);
      const wc = tab.atsView && tab.atsView.webContents;
      harvestTabAnswers(wc, tab).catch((err) => console.warn('[magnet] harvest:', (err && err.message) || err));
    }, delay)
  );
}

async function harvestTabById(id) {
  const tab = tabs.get(id);
  if (!tab) return { ok: false, error: 'missing' };
  const wc = tab.atsView && tab.atsView.webContents;
  return harvestTabAnswers(wc, tab);
}

async function harvestTabForUrl(url, extra = {}) {
  const tab = findTabByUrl(url);
  if (tab) {
    if (extra.company && tab.meta && !tab.meta.company && !tab.meta.name) tab.meta.name = extra.company;
    return harvestTabById(tab.meta.id);
  }
  if (extra.fields && extra.fields.length) {
    const { recordAnswers } = require('./lib/answer-log');
    const answers = recordAnswers(extra.fields, { url, company: extra.company || '', name: extra.company || '' });
    return { ok: true, count: answers.length, essays: answers.filter((row) => row.kind === 'essay').length, answers };
  }
  return { ok: false, error: 'no-tab' };
}

async function completeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return { ok: false };
  if (tab.atsView) {
    try {
      await evalFirstOk(tab.atsView.webContents, flushEssayMirrorsScript());
    } catch (_) {}
    let session = tab.essaySession || loadSession(id);
    session = await syncEssayFinals(tab.atsView.webContents, session);
    try {
      await harvestSweepStaticFields(tab.atsView.webContents, tab);
    } catch (_) {}
    session = await harvestApplicantEssays(tab.atsView.webContents, session, tab.meta.url);
    tab.essaySession = session;
    saveSession(id, tab.essaySession, tab.meta);
    try {
      await harvestTabAnswers(tab.atsView.webContents, tab);
    } catch (err) {
      console.warn('[magnet] harvest:', (err && err.message) || err);
    }
  }
  persistChat(tab);
  disposeTabAgent(tab).catch(() => {});
  const session = tab.essaySession || loadSession(id);
  const rows = commitVoice(tab, session);
  const snap = outcomeUndo.snapshotRecord(getRecord(tab.meta.url));
  const rec = appendEvent(tab.meta.url, { type: 'submitted', title: 'Applied' });
  writeJobRecord(tab.meta.url, {
    ...rec,
    jd: tab.jd || rec.jd,
    essays: (session.fields || []).map((f) => ({
      label: f.label,
      normalized_key: f.normalized_key,
      llm_draft: f.llm_draft,
      final: f.final,
      origin: f.origin || '',
    })),
  });
  bumpCount('submitted');
  timing.complete(tab);
  tab.autofillDetail = '';
  tab.mode = 'dashboard';
  let detail = '';
  if (rows.length) {
    const wrote = rows.filter((r) => r.origin === 'applicant').length;
    const rewrote = rows.filter((r) => r.origin === 'rewrite' || r.origin === 'edit').length;
    if (wrote) detail = `saved ${wrote} answer${wrote === 1 ? '' : 's'} you wrote yourself`;
    else if (rewrote) detail = `saved ${rewrote} of your essay edit${rewrote === 1 ? '' : 's'} for next drafts`;
    else detail = `${rows.length} drafts unchanged`;
  }
  const eligible = eligiblePairs(rows);
  bindShippedMagnet(rows);
  const shouldDebrief = Boolean(eligible.length && process.env.CURSOR_API_KEY);
  if (shouldDebrief) {
    tab.debrief = { pairs: eligible, proposed: null, status: 'open' };
    showMode(tab, 'dashboard');
    openChatDrawer(tab);
    notifySidebar();
    notifyChrome();
  } else {
    advanceAfterClose(id);
    notifySidebar();
  }
  armOutcomeUndo({
    id,
    kind: 'complete',
    snap,
    name: tab.meta.name,
    detail,
    congrats: 'submitted',
    debrief: shouldDebrief,
  });
  return { ok: true };
}

function passTab(id) {
  const tab = tabs.get(id);
  if (!tab) return { ok: false };
  const snap = outcomeUndo.snapshotRecord(getRecord(tab.meta.url));
  timing.pass(tab);
  appendEvent(tab.meta.url, { type: 'passed', title: 'Passed' });
  bumpCount('passed');
  persistChat(tab);
  disposeTabAgent(tab).catch(() => {});
  tab.autofillDetail = '';
  tab.mode = 'dashboard';
  advanceAfterClose(id);
  notifySidebar();
  armOutcomeUndo({
    id,
    kind: 'pass',
    snap,
    name: tab.meta.name,
  });
  return { ok: true };
}

function openDrawer(tab = 'chat') {
  drawerTab = PAGE_TABS.includes(tab) ? tab : chatTabs.asPageSubtab(tab);
  drawerOpen = true;
  ensureDrawerView();
  if (isCompactLayout()) setShellPane('chat', { relayout: false });
  if (drawerView) drawerView.webContents.send('magnet:drawer-mode', drawerTab);
  if (chromeView) chromeView.webContents.send('magnet:drawer-mode', drawerTab);
  layout();
}

function openIngest() {
  selectConversation(chatTabs.INGEST_KEY, { activate: false });
  notifySidebar();
  layout();
}

let essayLogWindow = null;
let insightsWindow = null;

function dataFile(page) {
  return page === 'library'
    ? path.join(__dirname, 'library', 'index.html')
    : path.join(__dirname, 'insights', 'index.html');
}

function openInsights(page) {
  const which = page === 'library' ? 'library' : 'insights';
  const title = which === 'library' ? 'Library' : 'Insights';
  if (insightsWindow && !insightsWindow.isDestroyed()) {
    const url = insightsWindow.webContents.getURL();
    const onPage = url.includes(`/${which}/`);
    insightsWindow.setTitle(title);
    insightsWindow.show();
    insightsWindow.focus();
    if (!onPage) insightsWindow.loadFile(dataFile(which));
    else if (which === 'insights') insightsWindow.webContents.send('magnet:insights-refresh');
    return { ok: true, reply: `${title} is open.` };
  }
  insightsWindow = new BrowserWindow({
    width: 1100,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    title,
    backgroundColor: '#12141a',
    parent: mainWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload-insights.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  insightsWindow.loadFile(dataFile(which));
  insightsWindow.on('closed', () => {
    insightsWindow = null;
  });
  return { ok: true };
}

function insightsView(config) {
  try {
    const data = require('./lib/insights-data');
    if (config !== undefined) {
      const saved = data.writeConfig(config);
      return data.insightsPayload(saved);
    }
    return data.insightsPayload();
  } catch (err) {
    console.warn('[magnet] insights:', (err && err.message) || err);
    return { error: (err && err.message) || 'Insights failed' };
  }
}

function openEssayLog() {
  if (essayLogWindow && !essayLogWindow.isDestroyed()) {
    essayLogWindow.show();
    essayLogWindow.focus();
    return { ok: true, reply: 'Essay log is open.' };
  }
  essayLogWindow = new BrowserWindow({
    width: 780,
    height: 860,
    minWidth: 520,
    minHeight: 480,
    title: 'Essay log',
    backgroundColor: '#12141a',
    parent: mainWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload-essay-log.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  essayLogWindow.loadFile(path.join(__dirname, 'essay-log', 'index.html'));
  essayLogWindow.on('closed', () => {
    essayLogWindow = null;
  });
  return { ok: true };
}

function closeIngest() {
  notifySidebar();
}

function openChatDrawer(tab) {
  const target = tab || (activeTabId && tabs.get(activeTabId));
  if (target) selectJobPage(target, 'chat');
  else openDrawer('chat');
}

function fillHooks(tab) {
  return {
    onStep: (s, extra) => {
      const stepChanged = s !== tab.autofillStep;
      tab.autofillStep = s;
      if (s === 'Done') {
        tab.essayBusy = false;
      }
      if (extra && extra.detail != null) tab.autofillDetail = extra.detail;
      else if (s === 'Done') tab.autofillDetail = '';
      if (stepChanged && s === 'Review') selectJobPage(tab, 'debug');
      else if (stepChanged && s === 'Essays' && !tab.reviewAbort) selectJobPage(tab, 'chat');
      notifyChrome();
      layout();
      if (extra && extra.toast) toast(extra.toast);
    },
    onLlm: () => notifyChrome(),
    onStream: (evt) => {
      const prev = tab.chatStream || { text: '', stage: '', drafts: [] };
      const next = { ...prev };
      if (evt.stage) next.stage = evt.stage;
      if (evt.streaming && evt.text) next.text = (prev.text || '') + evt.text;
      else if (evt.text != null && !evt.streaming) next.text = evt.text;
      if (evt.drafts) next.drafts = evt.drafts;
      if (evt.reviewing != null) next.reviewing = evt.reviewing;
      tab.chatStream = next;
      sendChatDelta(tab);
    },
  };
}

function sendChatDelta(tab) {
  if (!tab || !tab.meta) return;
  const payload = {
    id: tab.meta.id,
    key: tab.meta.url,
    stream: tab.chatStream,
  };
  if (chromeView) chromeView.webContents.send('magnet:chat-delta', payload);
  if (drawerView) drawerView.webContents.send('magnet:chat-delta', payload);
}

function essayFailDetail(err) {
  return /CURSOR_API_KEY/i.test(String(err || ''))
    ? 'Essay failed — add CURSOR_API_KEY to projects/jobmagnet/.env'
    : 'Essay draft failed — retry';
}

async function runFillJob(id, kind, fn) {
  const tab = tabs.get(id);
  if (!tab) return { ok: false, error: 'no-tab' };
  if (tab.fillCancelRequested) {
    tab.fillCancelRequested = false;
    tab.fillAbort = null;
    return { ok: true, cancelled: true };
  }
  if (tab.autofillStatus === 'running') return { ok: false, error: 'busy' };
  flushRichboi();
  flushSystemPrompt();
  ensureAtsView(tab);
  tab.mode = 'ats';
  if (isCompactLayout()) setShellPane('apply', { relayout: false });
  layout();
  tab.runKind = kind;
  tab.autofillStatus = 'running';
  tab.autofillDetail = '';
  tab.essayBusy = false;
  tab.essayError = '';
  attachFillAbort(tab);
  notifySidebar();
  const job = (async () => {
    try {
      return await fn(tab);
    } finally {
      tab.fillAbort = null;
      tab.fillCancelRequested = false;
    }
  })();
  tab.fillJob = job;
  try {
    const result = await job;
    if (result && result.cancelled) {
      tab.autofillStatus = 'idle';
      tab.autofillDetail = '';
      tab.essayBusy = false;
      notifySidebar();
      notifyChrome();
      layout();
      return result;
    }
    tab.autofillStatus = tab.essayError ? 'error' : 'idle';
    if (tab.essayError) {
      tab.autofillDetail = essayFailDetail(tab.essayError);
      toast(tab.autofillDetail);
    } else if (result && result.empty && kind === 'essays') {
      tab.autofillDetail = '';
      toast('No essay fields on this page');
    } else {
      tab.autofillDetail = '';
    }
    notifySidebar();
    notifyChrome();
    layout();
    return result;
  } catch (err) {
    if (isFillCancelled(err)) {
      tab.autofillStatus = 'idle';
      tab.autofillDetail = '';
      tab.essayBusy = false;
      notifySidebar();
      notifyChrome();
      layout();
      return { ok: true, cancelled: true };
    }
    const haltMsg = err && err.halt ? String(err.message || err) : '';
    tab.autofillStatus = 'error';
    tab.autofillDetail = haltMsg;
    if (haltMsg && !err.notified) toast(haltMsg);
    notifySidebar();
    notifyChrome();
    layout();
    return { ok: false, error: String(err.message || err), halt: Boolean(err && err.halt) };
  } finally {
    tab.fillJob = null;
  }
}

async function cancelFillJob(id) {
  const tab = tabs.get(id);
  if (!tab || tab.autofillStatus !== 'running') return { ok: false, error: 'idle' };
  cancelFill(tab);
  const wc = tab.atsView && tab.atsView.webContents;
  if (wc) {
    evalFirstOk(wc, '(() => { window.__magnetEssayTypeStop = true; return { ok: true }; })()').catch(() => {});
  }
  if (tab.fillJob) {
    try {
      await tab.fillJob;
    } catch (_) {}
  }
  return { ok: true, cancelled: true };
}

async function startStage(id, kind, fn) {
  const tab = tabs.get(id);
  if (tab && tab.autofillStatus === 'running') await cancelFillJob(id);
  return runFillJob(id, kind, fn);
}

async function startAutofill(id) {
  const tab = tabs.get(id);
  if (tab && tab.autofillStatus === 'running') return cancelFillJob(id);
  return startAll(id);
}

async function startAll(id, opts = {}) {
  if (!opts.chain) {
    autofillChainLeft = asQueueN(appSettings && appSettings.autofillQueueN);
  }
  const result = await startStage(id, 'all', (tab) =>
    runAutofill(tab.atsView.webContents, tab, {
      ...fillHooks(tab),
      parallelReviewEssays: true,
      upload: () => attachResumeFile(tab, { quiet: true }),
    })
  );
  const tab = tabs.get(id);
  if (tab && tab.meta && tab.meta.url && !(result && result.cancelled)) {
    appendEvent(tab.meta.url, { type: 'autofill', title: 'Autofill' });
  }
  noticeCompletion(tab, 'all', result);
  if (!(result && result.cancelled)) scheduleAutofillChain(id);
  return result;
}

function tabLooksFilled(tab) {
  if (!tab) return false;
  const rec = getRecord(tab.meta.url);
  if (hasAutofillRun(rec)) return true;
  if (Array.isArray(rec.essays) && rec.essays.length) return true;
  const fields = tab.debugFields || [];
  return fields.some((f) => String((f && (f.value != null ? f.value : f.current)) || '').trim());
}

function pickNextAutofillTab(afterId) {
  const ids = listedJobIds({ status: 'open' });
  const start = ids.indexOf(afterId);
  const rest = start === -1 ? ids : ids.slice(start + 1);
  for (const id of rest) {
    const tab = tabs.get(id);
    if (tab && isOpen(tab.meta.url) && !tabLooksFilled(tab)) return id;
  }
  return null;
}

function scheduleAutofillChain(afterId) {
  if (autofillChainLeft <= 0) return;
  setTimeout(() => {
    void runNextAutofillInChain(afterId);
  }, 80);
}

async function runNextAutofillInChain(afterId) {
  while (autofillChainLeft > 0) {
    const nextId = pickNextAutofillTab(afterId);
    if (!nextId) {
      autofillChainLeft = 0;
      return;
    }
    const tab = tabs.get(nextId);
    if (tabLooksFilled(tab)) {
      afterId = nextId;
      continue;
    }
    autofillChainLeft -= 1;
    activateTab(nextId);
    await startAll(nextId, { chain: true });
    return;
  }
}

function persistTabJd(tab) {
  if (!tab || !tab.meta || !tab.meta.url || !tab.jd || !tab.jd.text) return;
  if (!(tab.jd.findings && tab.jd.findings.findings)) {
    tab.jd.findings = scanJobDescription(tab.jd.text);
  }
  writeJobRecord(tab.meta.url, { jd: tab.jd });
}

async function startJd(id) {
  const result = await startStage(id, 'jd', async (tab) => {
    const hooks = fillHooks(tab);
    tab.jd = preferPostingJd(tab) || tab.jd;
    selectJobPage(tab, 'jd');
    await ensureTabJd(tab.atsView.webContents, tab, hooks);
    persistTabJd(tab);
    hooks.onStep('Done', { detail: '' });
    return { ok: true, jd: tab.jd };
  });
  noticeCompletion(tabs.get(id), 'jd', result);
  return result;
}

async function startFill(id) {
  const result = await startStage(id, 'fill', (tab) =>
    runAutofill(tab.atsView.webContents, tab, {
      ...fillHooks(tab),
      skipReview: true,
      skipEssays: true,
    })
  );
  noticeCompletion(tabs.get(id), 'fill', result);
  return result;
}

async function startEssays(id, opts = {}) {
  const result = await startStage(id, 'essays', (tab) =>
    runEssays(tab.atsView.webContents, tab, {
      ...fillHooks(tab),
      fieldIds: opts.fieldIds,
      instruction: opts.instruction,
    })
  );
  const noticed = noticeCompletion(tabs.get(id), 'essays', result, { skipChatLog: opts.skipChatLog });
  if (result && typeof result === 'object') result.alerts = noticed.alerts;
  return result;
}

async function setFileInput(wc, selector, abs) {
  const dbg = wc.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  try {
    const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1 });
    const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return { ok: false, error: 'no-node' };
    await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [abs] });
    return { ok: true, nodeId };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

async function attachResumeFile(tab, opts = {}) {
  const quiet = Boolean(opts.quiet);
  if (!tab || !tab.atsView) {
    if (!quiet) toast('Open an apply page first');
    return { ok: false, error: 'Open an apply page first' };
  }
  if (tab.fillAbort && tab.fillAbort.signal.aborted) return { ok: true, cancelled: true };
  const wc = tab.atsView.webContents;
  const found = await evalFirstOk(wc, FIND_FILE_SCRIPT);
  if (!found || !found.ok) {
    if (!quiet) toast('No resume upload on this page');
    return { ok: false, error: 'No resume upload on this page' };
  }
  if (found.already) {
    if (!quiet) toast('Already attached');
    tab.resumeUploaded = true;
    notifyChrome();
    return { ok: true, already: true };
  }
  if (!tab.resume || !tab.resume.abs) {
    tab.resume = pickResume(tab.meta);
  }
  const pdf = tab.resume && tab.resume.abs;
  if (!pdf || !fs.existsSync(pdf)) {
    toast('Resume file missing — import one in Settings');
    return { ok: false, error: 'Resume file missing' };
  }
  const pageUrl = (wc.getURL && wc.getURL()) || '';
  if (/greenhouse\.io/i.test(pageUrl)) {
    let ready = false;
    for (let i = 0; i < 25; i++) {
      const hit = await evalFirstOk(wc, GREENHOUSE_UPLOADER_SCRIPT);
      if (hit && hit.ready) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!ready) {
      // job-boards.greenhouse.io renders a plain file input with no React
      // uploader fiber. setFileInputFiles still attaches that input.
      const plain = await evalFirstOk(
        wc,
        `(() => ({ ok: true, has: Boolean(document.querySelector('input#resume, input[name="resume"][type="file"]')) }))()`
      );
      if (!plain || !plain.has) {
        const error = 'Greenhouse resume uploader was not ready';
        if (!quiet) toast(error);
        return { ok: false, error };
      }
    }
  }
  const set = await setFileInput(wc, found.selector, pdf);
  if (!set.ok) {
    const error = set.error || 'Could not set the resume file';
    if (!quiet) toast(error);
    return { ok: false, error };
  }
  if (/greenhouse\.io/i.test(pageUrl)) {
    const replay = await evalFirstOk(wc, GREENHOUSE_RESUME_CHANGE_SCRIPT);
    // setFileInputFiles already fires the native change. Greenhouse then
    // replaces #resume with the filename, so the change script's later
    // lookup reports no-file even though the file is on the page.
    if (replay && replay.ok === false && replay.error !== 'no-file') {
      const error = replay.error || "Cannot read properties of undefined (reading 'uploadFile')";
      if (!quiet) toast(error);
      return { ok: false, error };
    }
  }
  const body = await evalFirstOk(wc, VERIFY_FILE_SCRIPT);
  const base = path.basename(pdf);
  const verified = set.ok && body && String(body.text || '').includes(base.replace(/\.[^.]+$/, '').slice(0, 12));
  if (verified || set.ok) {
    tab.resumeUploaded = true;
    toast(`${tab.resume.label} uploaded`);
    notifyChrome();
    return { ok: true };
  }
  const err = `Couldn’t attach ${base} — drop it on the page`;
  toast(err);
  return { ok: false, error: err };
}

async function startUploadResume(id, opts = {}) {
  if (opts.nested || opts.quiet) return attachResumeFile(tabs.get(id), opts);
  const result = await startStage(id, 'resume', async (tab) => {
    const hooks = fillHooks(tab);
    hooks.onStep('Apply?', { detail: 'Uploading resume…' });
    const out = await attachResumeFile(tab, opts);
    hooks.onStep('Done', { detail: '' });
    return out;
  });
  noticeCompletion(tabs.get(id), 'resume', result);
  return result;
}

function listLiveJobs() {
  try {
    persist.open();
    return persist.nodeStore().listJobs();
  } catch (_) {
    try {
      return loadJobsFile(JOBS_FILE);
    } catch {
      return [];
    }
  }
}

function ingestYamlJobs() {
  try {
    const have = new Set(listLiveJobs().map((j) => j.url));
    loadJobsFile(JOBS_FILE).forEach((job) => {
      if (job && job.url && !have.has(job.url)) persist.nodeStore().upsertJob(job);
    });
  } catch (_) {}
}

function currentJobEntries() {
  if (process.env.MAGNET_JOBS_FILE) return loadJobsFile(JOBS_FILE);
  return mergeJobEntries(listLiveJobs(), loadSubmissions());
}

function installJobTabs(entries) {
  for (const meta of entries) {
    if (!meta || !meta.id) continue;
    if (tabs.has(meta.id)) {
      const tab = tabs.get(meta.id);
      tab.meta = { ...tab.meta, ...meta, status: meta.status || tab.meta.status };
      continue;
    }
    shellTab(meta);
  }
}

function prioritizeBoot(filter) {
  if (!tabBoot || tabBoot.done || !tabBoot.pending.length) return;
  const match = sidebarFilters.apply(tabBoot.pending, filter);
  const ids = new Set(match.map((meta) => meta && meta.id).filter(Boolean));
  const rest = tabBoot.pending.filter((meta) => meta && !ids.has(meta.id));
  tabBoot.pending = match.concat(rest);
}

function takeBootTabs(n) {
  if (!tabBoot || tabBoot.done || !tabBoot.pending.length) return 0;
  const chunk = tabBoot.pending.splice(0, Math.max(1, n));
  for (const meta of chunk) shellTab(meta);
  return chunk.length;
}

function finishBootTabs(entries) {
  if (!tabBoot || tabBoot.done) return;
  tabBoot.done = true;
  tabBoot.pending = [];
  try {
    persistUi(chatUi);
  } catch (err) {
    console.warn('[magnet] chat ui:', (err && err.message) || err);
  }
  notifySidebar();
  const jobs = entries;
  setImmediate(() => {
    try {
      seedBoardsFromJobs(jobs);
    } catch (err) {
      console.warn('[magnet] boards:', (err && err.message) || err);
    }
  });
}

function releaseBootTabs(n, entries) {
  const added = takeBootTabs(n);
  if (!tabBoot || tabBoot.done) return added;
  if (!tabBoot.pending.length) finishBootTabs(entries);
  else notifySidebar();
  return added;
}

function loadSavedChats() {
  if (chatStoreReady) return;
  chatStoreReady = true;
  try {
    ingestChat = loadChat(INGEST_CHAT_KEY) || [];
  } catch (err) {
    console.warn('[magnet] ingest chat:', (err && err.message) || err);
  }
  try {
    chatUi = chatTabs.normalizeUi(loadChatUi());
  } catch (err) {
    console.warn('[magnet] chat ui:', (err && err.message) || err);
  }
  ensureSetupWelcome();
}

function startTabQueue(entries, gen) {
  if (gen !== bootGen) return;
  seedSupabaseStatus(entries);
  const hasOpen = (entries || []).some((meta) => meta && (!meta.status || meta.status === 'open'));
  if (!hasOpen && sidebarFilter.status === 'open') {
    sidebarFilter = sidebarFilters.normalize({ ...sidebarFilter, status: 'all' });
  }
  const ranked = sidebarFilters.apply(entries, sidebarFilter);
  const ordered = ranked.slice();
  const seen = new Set(ordered.map((meta) => meta && meta.id).filter(Boolean));
  for (const meta of entries) {
    if (meta && meta.id && !seen.has(meta.id)) ordered.push(meta);
  }
  const lead = ordered.splice(0, BOOT_TABS);
  for (const meta of lead) shellTab(meta);
  tabBoot = { pending: ordered, done: false, entries };
  layout();
  notifySidebar();
  const first = lead.find((meta) => !meta.status || meta.status === 'open') || lead[0];
  const pump = () => {
    if (!tabBoot || tabBoot.done) return;
    releaseBootTabs(SIDEBAR_BATCH, entries);
    if (tabBoot && !tabBoot.done) setImmediate(pump);
  };
  setTimeout(() => {
    if (gen !== bootGen) return;
    if (first) {
      activateTab(first.id);
      const tab = tabs.get(first.id);
      if (tab && tab.meta.id !== HUNT_TAB_ID && chatTabs.isIngest(activeChatKey())) {
        selectJobPage(tab, tab.pageSubtab || 'chat');
      }
    }
    setTimeout(pump, 0);
  }, 50);
  if (!ordered.length) finishBootTabs(entries);
}

function bootJobTabs() {
  const gen = ++bootGen;
  if (!require('./lib/store/mode').isSupabase()) {
    loadSavedChats();
    try {
      graph.ensureOpen();
      graph.seedVoiceFromFile(loadRichboi());
    } catch (_) {}
    let entries = [];
    try {
      entries = currentJobEntries();
    } catch (err) {
      console.warn('[magnet] jobs:', (err && err.message) || err);
    }
    startTabQueue(entries, gen);
    return;
  }
  persist.open();
  const api = persist.nodeStore();
  Promise.all([
    (async () => {
      try {
        const [state, ui] = await Promise.all([
          api.getChatStateAsync(INGEST_CHAT_KEY),
          api.getChatUiAsync(),
        ]);
        if (gen !== bootGen || chatStoreReady) return;
        ingestChat = (state && state.messages) || [];
        chatUi = chatTabs.normalizeUi(ui);
        chatStoreReady = true;
        ensureSetupWelcome();
      } catch (err) {
        console.warn('[magnet] chats:', (err && err.message) || err);
      }
    })(),
    typeof api.warm === 'function' ? api.warm() : Promise.resolve(),
    refreshStrategy(),
    (typeof api.listJobsAsync === 'function' ? api.listJobsAsync() : Promise.resolve([])).catch((err) => {
      console.warn('[magnet] jobs:', (err && err.message) || err);
      return [];
    }),
  ]).then((result) => {
    if (gen !== bootGen) return;
    let entries = [];
    try {
      const jobs = result[3] || [];
      entries = process.env.MAGNET_JOBS_FILE ? loadJobsFile(JOBS_FILE) : mergeJobEntries(jobs, loadSubmissions());
    } catch (err) {
      console.warn('[magnet] jobs:', (err && err.message) || err);
    }
    startTabQueue(entries, gen);
    setImmediate(() => {
      if (gen !== bootGen) return;
      try {
        graph.ensureOpen();
        graph.seedVoiceFromFile(loadRichboi());
      } catch (_) {}
    });
  });
}

function reloadJobs() {
  bootGen += 1;
  if (tabBoot && !tabBoot.done) {
    tabBoot.done = true;
    tabBoot.pending = [];
  }
  if (!process.env.MAGNET_JOBS_FILE && !require('./lib/store/mode').isSupabase()) ingestYamlJobs();
  const entries = currentJobEntries();
  const keep = new Set(entries.map((e) => e.id));
  for (const [id, tab] of tabs) {
    if (!keep.has(id) && id !== HUNT_TAB_ID) {
      if (id === activeTabId) timing.closeActive('removed');
      destroyAts(tab);
      if (tab.dashView && mainWindow) {
        try {
          mainWindow.removeBrowserView(tab.dashView);
        } catch (_) {}
      }
      tabs.delete(id);
    }
  }
  installJobTabs(entries);
  notifySidebar();
}

async function sessionCaptureJd(url) {
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    webPreferences: {
      partition: SHARED_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await loadPageUrl(win.webContents, url);
    await new Promise((r) => setTimeout(r, 1400));
    const evalFn = (script) => evalFirstOk(win.webContents, script);
    const jd = await captureJd(evalFn);
    if (!jd || !jd.text) return jd;
    let ctas = [];
    try {
      const listed = await evalFn(LIST_VISIBLE_CTAS_SCRIPT);
      ctas = (listed && listed.ctas) || [];
    } catch (_) {}
    return fillApplyCue(jd, {
      meta: { href: url, title: (jd && jd.title) || '', ctas },
    });
  } finally {
    try {
      win.destroy();
    } catch (_) {}
  }
}

async function enrichMissingJds(urls) {
  let n = 0;
  for (const url of urls || []) {
    const rec = getRecord(url);
    if (!needsJdCapture(rec.jd)) continue;
    const tab = [...tabs.values()].find((t) => t.meta.url === url);
    const posting = (tab && (tab.meta.posting || tab.meta.linkedin)) || rec.posting || url;
    try {
      const jd = await Promise.race([
        sessionCaptureJd(posting),
        new Promise((_, rej) => setTimeout(() => rej(new Error('jd-timeout')), 15000)),
      ]);
      if (jd && jd.text && shouldReplaceJd(rec.jd, jd.text)) {
        writeJobRecord(url, { jd, posting });
        if (tab) {
          tab.jd = jd;
          tab.jdVerified = looksLikeJobDescription(jd.text);
        }
        n += 1;
      }
    } catch (err) {
      console.warn('[magnet] session jd', posting, err.message || err);
    }
  }
  return n;
}

async function finishIngest(out) {
  if (out && out.needConnect) {
    const r = await connectGmail();
    return { ...out, ...r, reply: r.reply || out.reply };
  }
  if (out && out.needScan) {
    const r = await runMailScan();
    return { ...out, ...r, reply: r.reply || out.reply };
  }
  reloadJobs();
  const missing = (out.urls || []).filter((url) => {
    const rec = getRecord(url);
    return needsJdCapture(rec.jd);
  });
  if (missing.length) {
    const extra = await enrichMissingJds(missing);
    if (extra) {
      out.jds = Number(out.jds || 0) + extra;
      out.reply = `${out.reply || ''} Session captured ${extra} more JDs.`.trim();
      reloadJobs();
    }
  }
  notifyChrome();
  return out;
}

function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { raw };
  }
}

function startControlApi() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    const url = new URL(req.url || '/', `http://127.0.0.1:${CONTROL_PORT}`);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { ok: true, activeTabId, tabs: tabs.size });
      }
      if (req.method === 'GET' && url.pathname === '/window') {
        const [width, height] = mainWindow ? mainWindow.getContentSize() : [0, 0];
        return json(res, 200, { width, height, compact: isCompactLayout(), pane: shellPane, drawerTab });
      }
      if (req.method === 'POST' && url.pathname === '/window') {
        const body = await readBody(req);
        if (mainWindow && body.width && body.height) {
          mainWindow.setContentSize(Math.round(Number(body.width)), Math.round(Number(body.height)));
        }
        if (body.pane) setShellPane(String(body.pane), { relayout: false });
        layout();
        notifyShellPane();
        const [width, height] = mainWindow ? mainWindow.getContentSize() : [0, 0];
        return json(res, 200, { width, height, compact: isCompactLayout(), pane: shellPane, drawerTab });
      }
      if (req.method === 'GET' && url.pathname === '/tabs') {
        return json(res, 200, { activeTabId, tabs: [...tabs.values()].map((t) => chromePayload(t)) });
      }
      if (req.method === 'GET' && url.pathname === '/jobs') {
        return json(res, 200, { jobs: listLiveJobs() });
      }
      if (req.method === 'POST' && url.pathname === '/jobs/reload') {
        reloadJobs();
        return json(res, 200, { ok: true, n: tabs.size });
      }
      if (req.method === 'GET' && url.pathname === '/profile') {
        const p = path.join(__dirname, 'knowledge', 'applicant-profile.yaml');
        return json(res, 200, yaml.load(fs.readFileSync(p, 'utf8')));
      }
      if (req.method === 'GET' && url.pathname === '/essay-log') {
        const { listEssays } = require('./lib/essay-browser');
        return json(
          res,
          200,
          listEssays({
            q: url.searchParams.get('q') || '',
            company: url.searchParams.get('company') || '',
            sort: url.searchParams.get('sort') || 'ts',
            limit: url.searchParams.get('limit') || 50,
            unique: url.searchParams.get('unique'),
            min: url.searchParams.get('min'),
            all: url.searchParams.get('all'),
          })
        );
      }
      const act = url.pathname.match(/^\/tabs\/([^/]+)\/activate$/);
      if (req.method === 'POST' && act) {
        return json(res, 200, { ok: activateTab(decodeURIComponent(act[1])) });
      }
      const ev = url.pathname.match(/^\/tabs\/([^/]+)\/eval$/);
      if (req.method === 'POST' && ev) {
        const tab = tabs.get(decodeURIComponent(ev[1]));
        const body = await readBody(req);
        if (!tab || !tab.atsView) return json(res, 404, { error: 'no-view' });
        const result = await evalFirstOk(tab.atsView.webContents, body.script || body.js || '');
        scheduleHarvest(tab);
        return json(res, 200, { result });
      }
      const pointer = url.pathname.match(/^\/tabs\/([^/]+)\/pointer$/);
      if (req.method === 'POST' && pointer) {
        const id = decodeURIComponent(pointer[1]);
        const tab = tabs.get(id);
        const body = await readBody(req);
        if (!tab) return json(res, 404, { error: 'missing' });
        activateTab(id);
        ensureAtsView(tab);
        const wc = tab.atsView && tab.atsView.webContents;
        if (!wc) return json(res, 404, { error: 'no-view' });
        let point = body || {};
        if (body.script) point = (await evalFirstOk(wc, body.script)) || {};
        const x = Math.round(Number(point.x));
        const y = Math.round(Number(point.y));
        if (!point.ok || !Number.isFinite(x) || !Number.isFinite(y)) {
          return json(res, 400, { error: 'no-point', point });
        }
        wc.focus();
        wc.sendInputEvent({ type: 'mouseMove', x, y, movementX: 0, movementY: 0 });
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        return json(res, 200, { ok: true, x, y });
      }
      const insert = url.pathname.match(/^\/tabs\/([^/]+)\/insert$/);
      if (req.method === 'POST' && insert) {
        const id = decodeURIComponent(insert[1]);
        const tab = tabs.get(id);
        const body = await readBody(req);
        if (!tab) return json(res, 404, { error: 'missing' });
        activateTab(id);
        ensureAtsView(tab);
        const wc = tab.atsView && tab.atsView.webContents;
        if (!wc) return json(res, 404, { error: 'no-view' });
        wc.focus();
        wc.insertText(String(body.text == null ? '' : body.text));
        scheduleHarvest(tab);
        return json(res, 200, { ok: true });
      }
      const af = url.pathname.match(/^\/tabs\/([^/]+)\/autofill$/);
      if (req.method === 'POST' && af) return json(res, 200, await startAutofill(decodeURIComponent(af[1])));
      const all = url.pathname.match(/^\/tabs\/([^/]+)\/all$/);
      if (req.method === 'POST' && all) return json(res, 200, await startAll(decodeURIComponent(all[1])));
      const cancel = url.pathname.match(/^\/tabs\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && cancel) return json(res, 200, await cancelFillJob(decodeURIComponent(cancel[1])));
      const jdOnly = url.pathname.match(/^\/tabs\/([^/]+)\/jd$/);
      if (req.method === 'POST' && jdOnly) return json(res, 200, await startJd(decodeURIComponent(jdOnly[1])));
      const fillOnly = url.pathname.match(/^\/tabs\/([^/]+)\/fill$/);
      if (req.method === 'POST' && fillOnly) return json(res, 200, await startFill(decodeURIComponent(fillOnly[1])));
      const essays = url.pathname.match(/^\/tabs\/([^/]+)\/essays$/);
      if (req.method === 'POST' && essays) {
        const body = await readBody(req);
        return json(
          res,
          200,
          await startEssays(decodeURIComponent(essays[1]), {
            fieldIds: body.fieldIds || body.ids,
            instruction: body.instruction || body.text,
          })
        );
      }
      const llm = url.pathname.match(/^\/tabs\/([^/]+)\/llm$/);
      if (req.method === 'GET' && llm) {
        const tab = tabs.get(decodeURIComponent(llm[1]));
        return json(res, tab ? 200 : 404, tab ? tab.lastLlm || null : { error: 'missing' });
      }
      const up = url.pathname.match(/^\/tabs\/([^/]+)\/upload-resume$/);
      if (req.method === 'POST' && up) {
        const id = decodeURIComponent(up[1]);
        const body = await readBody(req);
        if (body && body.resumeId) {
          const tab = tabs.get(id);
          if (tab) {
            tab.resumeOverride = body.resumeId;
            tab.resume = pickResume(tab.meta, body.resumeId);
          }
        }
        return json(res, 200, await startUploadResume(id));
      }
      const upAlias = url.pathname.match(/^\/tabs\/([^/]+)\/upload$/);
      if (req.method === 'POST' && upAlias) return json(res, 200, await startUploadResume(decodeURIComponent(upAlias[1])));
      const snap = url.pathname.match(/^\/tabs\/([^/]+)\/snapshot$/);
      if (req.method === 'GET' && snap) {
        const tab = tabs.get(decodeURIComponent(snap[1]));
        if (!tab || !tab.atsView) return json(res, 404, { error: 'no-view' });
        const page = await snapshotPage(tab.atsView.webContents);
        scheduleHarvest(tab, 400);
        return json(res, 200, page);
      }
      const harvestOne = url.pathname.match(/^\/tabs\/([^/]+)\/harvest-answers$/);
      if (req.method === 'POST' && harvestOne) {
        return json(res, 200, await harvestTabById(decodeURIComponent(harvestOne[1])));
      }
      if (req.method === 'POST' && url.pathname === '/harvest-answers') {
        const body = await readBody(req);
        if (!body.url) return json(res, 400, { error: 'url required' });
        return json(res, 200, await harvestTabForUrl(body.url, body));
      }
      const jd = url.pathname.match(/^\/tabs\/([^/]+)\/jd$/);
      if (req.method === 'GET' && jd) {
        const tab = tabs.get(decodeURIComponent(jd[1]));
        return json(res, tab ? 200 : 404, tab ? tab.jd : { error: 'missing' });
      }
      const jdc = url.pathname.match(/^\/tabs\/([^/]+)\/jd\/clipboard$/);
      if (req.method === 'POST' && jdc) {
        const tab = tabs.get(decodeURIComponent(jdc[1]));
        const text = htmlToJdText(clipboard.readText());
        tab.jd = {
          text,
          source: 'clipboard',
          captured_at: new Date().toISOString(),
          findings: scanJobDescription(text),
        };
        tab.jdVerified = looksLikeJobDescription(text);
        persistTabJd(tab);
        selectJobPage(tab, 'jd');
        return json(res, 200, tab.jd);
      }
      if (req.method === 'POST' && url.pathname === '/ingest/intent') {
        const body = await readBody(req);
        const out = await handleIngestMessage(body.message || body.raw || '');
        return json(res, 200, out);
      }
      if (req.method === 'POST' && url.pathname === '/knowledge/verify') {
        const body = await readBody(req);
        try {
          return json(res, 200, learnRecipe({ label: body.label, value: body.answer, host: body.host }));
        } catch (err) {
          return json(res, 400, { error: String(err.message || err) });
        }
      }
      if (req.method === 'POST' && url.pathname === '/knowledge/learn') {
        const body = await readBody(req);
        try {
          return json(res, 200, learnRecipe(body));
        } catch (err) {
          return json(res, 400, { error: String(err.message || err) });
        }
      }
      const rej = url.pathname.match(/^\/process\/(.+)\/rejected$/);
      if (req.method === 'POST' && rej) {
        const jobUrl = decodeURIComponent(rej[1]);
        const body = await readBody(req);
        appendEvent(jobUrl, { type: 'rejected', title: 'Rejected', body: body.note || '' });
        bumpCount('rejected');
        notifySidebar();
        return json(res, 200, getRecord(jobUrl));
      }
      const evp = url.pathname.match(/^\/process\/(.+)\/event$/);
      if (req.method === 'POST' && evp) {
        const jobUrl = decodeURIComponent(evp[1]);
        const body = await readBody(req);
        return json(res, 200, appendEvent(jobUrl, body));
      }
      if (req.method === 'GET' && url.pathname === '/mail/oauth/callback') {
        const result = await handleOAuthCallback(Object.fromEntries(url.searchParams));
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        const msg = result.ok ? 'Gmail connected. You can close this window.' : String(result.reply || 'OAuth failed');
        res.end(
          `<!doctype html><meta charset="utf-8"><p>${msg.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>`
        );
        return;
      }
      if (req.method === 'POST' && url.pathname === '/mail/connect') {
        return json(res, 200, await connectGmail());
      }
      if (req.method === 'POST' && url.pathname === '/mail/scan') {
        return json(res, 200, await runMailScan());
      }
      if (req.method === 'POST' && url.pathname === '/mail/verification-code') {
        const body = await readBody(req);
        return json(res, 200, await findMailVerificationCode(body));
      }
      if (req.method === 'GET' && url.pathname === '/mail/status') {
        return json(res, 200, mailStatus());
      }
      if (req.method === 'POST' && url.pathname === '/mail/resolve') {
        const body = await readBody(req);
        const out = resolveQueue(body.id, body.action);
        if (out.ok) applyMailResolves(out);
        return json(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && url.pathname.startsWith('/hunt/')) {
        const op = url.pathname.slice('/hunt/'.length);
        const body = await readBody(req);
        return json(res, 200, await huntOp(op, body));
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      console.warn('[magnet] control:', (err && err.stack) || err);
      return json(res, 500, { error: String(err.message || err) });
    }
  });
  server.listen(CONTROL_PORT, '127.0.0.1', () => {
    console.log(`[magnet] control http://127.0.0.1:${CONTROL_PORT}`);
  });
}

async function handleIngestMessage(message) {
  const text = String(message || '').trim();
  if (!text) return { ok: false, reply: 'Empty.' };
  ingestChat = Array.isArray(ingestChat) ? ingestChat : [];
  if (huntState.loginWait) {
    ingestChat.push({ role: 'you', text, at: Date.now() });
    const kind = huntLoginReply(text);
    if (kind && kind.skipped) {
      resolveHuntLogin({ skipped: true });
      huntPush('Skipping this site.');
      return { ok: true, reply: 'Skipping this site.' };
    }
    huntPush('Checking whether you are signed in…');
    return { ok: true, reply: 'Checking whether you are signed in…' };
  }
  ingestChat.push({ role: 'you', text, at: Date.now() });
  ingestChat = trimChat(ingestChat);
  ingestBusy = true;
  persistIngestChat();
  persistUi(chatTabs.selectTab(chatUi, chatTabs.INGEST_KEY));
  notifySidebar();
  const ac = attachIngestAbort();
  let cancelled = false;
  try {
    if (setupGuide.incomplete(setupSnapshot())) {
      const guided = await runSetupTurn(text);
      ingestChat.push({
        role: 'magnet',
        text: guided.reply,
        asks: guided.asks || [],
        at: Date.now(),
      });
      ingestChat = trimChat(ingestChat);
      persistIngestChat();
      notifyChrome();
      return guided;
    }
    if (looksLikeApprove(text) && lastIngestPlan()) {
      const approved = await handleIngestApprove(lastIngestPlan());
      cancelled = Boolean(approved && approved.cancelled);
      return approved;
    }
    const out = await runIngestChat(text, ingestChat.slice(0, -1), { signal: ac.signal });
    if (ingestWasCancelled()) {
      cancelled = true;
      return { ok: true, cancelled: true };
    }
    if (out && (out.needConnect || out.needScan)) {
      const finished = await finishIngest(out);
      ingestChat.push({
        role: 'magnet',
        text: (finished && finished.reply) || (out && out.reply) || 'Okay.',
        tools: (out && out.tools) || [],
        asks: (out && out.asks) || [],
        at: Date.now(),
      });
      ingestChat = trimChat(ingestChat);
      persistIngestChat();
      return finished;
    }
    if (out && (out.needApproval || out.plan || out.schema)) {
      ingestPlan = normalizeSchema(out.plan || out.schema);
      ingestChat.push({
        role: 'magnet',
        text: (out && out.reply) || 'Okay.',
        plan: ingestPlan,
        tools: (out && out.tools) || [],
        asks: (out && out.asks) || [],
        sent: (out && out.sent) || null,
        received: (out && out.received) || null,
        at: Date.now(),
      });
      ingestChat = trimChat(ingestChat);
      persistIngestChat();
      return { ...out, plan: ingestPlan, schema: ingestPlan, needApproval: true };
    }
    const finished = await finishIngest(out);
    ingestChat.push({
      role: 'magnet',
      text: (finished && finished.reply) || (out && out.reply) || 'Okay.',
      tools: (out && out.tools) || [],
      asks: (out && out.asks) || [],
      sent: (out && out.sent) || null,
      received: (out && out.received) || null,
      at: Date.now(),
    });
    ingestChat = trimChat(ingestChat);
    persistIngestChat();
    return finished;
  } catch (err) {
    if (ingestWasCancelled(err)) {
      cancelled = true;
      return { ok: true, cancelled: true };
    }
    const fail = String((err && err.message) || err);
    ingestChat.push({
      role: 'magnet',
      text: 'Ingest failed.',
      folds: [{ level: 'error', label: 'error', text: fail }],
      at: Date.now(),
    });
    ingestChat = trimChat(ingestChat);
    persistIngestChat();
    return { ok: false, error: fail, reply: 'Ingest failed.' };
  } finally {
    ingestBusy = false;
    ingestAbort = null;
    ingestCancelRequested = false;
    notifySidebar();
    pingAttention('chat', { ok: true, cancelled });
  }
}

async function handleIngestApprove(schema) {
  const plan = normalizeSchema(schema || lastIngestPlan() || {});
  persistUi(chatTabs.selectTab(chatUi, chatTabs.INGEST_KEY));
  ingestBusy = true;
  ingestPlan = plan;
  persistIngestChat();
  notifySidebar();
  const ac = attachIngestAbort();
  let cancelled = false;
  try {
    if (!process.env.CURSOR_API_KEY) {
      throw new Error('Need CURSOR_API_KEY in .env so Magnet can drive the hunt.');
    }
    const saved = loadHuntSession();
    const resume = canResume(saved, plan);
    huntPush(
      resume
        ? `Resuming hunt at ${saved.added.length}/${plan.n}…`
        : `Hunting ${plan.n} new matches on ${plan.sites.join(', ')}…`
    );
    const searched = await executeSearchPlan(plan, { signal: ac.signal, key: INGEST_CHAT_KEY, resume });
    if (ingestWasCancelled()) {
      cancelled = true;
      persistHuntCancel();
      return { ok: true, cancelled: true };
    }
    const finished = await finishIngest(searched);
    persistLiveHunt(null);
    huntState = emptyHuntState();
    ingestPlan = null;
    ingestChat.push({
      role: 'magnet',
      text: (finished && finished.reply) || (searched && searched.reply) || 'Search finished.',
      at: Date.now(),
    });
    ingestChat = trimChat(ingestChat);
    persistIngestChat();
    return { ...finished, schema: plan };
  } catch (err) {
    if (ingestWasCancelled(err)) {
      cancelled = true;
      persistHuntCancel();
      return { ok: true, cancelled: true };
    }
    const fail = String((err && err.message) || err);
    persistHuntCancel();
    ingestChat.push({
      role: 'magnet',
      text: 'Search failed.',
      folds: [{ level: 'error', label: 'error', text: fail }],
      at: Date.now(),
    });
    ingestChat = trimChat(ingestChat);
    persistIngestChat();
    return { ok: false, error: fail, reply: 'Search failed.' };
  } finally {
    ingestBusy = false;
    ingestAbort = null;
    ingestCancelRequested = false;
    notifySidebar();
    pingAttention('chat', { ok: true, cancelled });
  }
}

function createWindow() {
  installPageLanguageSession();
  try {
    persist.open();
    persist.migrateFromYaml();
  } catch (err) {
    console.warn('[magnet] persist migrate:', (err && err.message) || err);
  }
  try {
    adoptSavedHunt(loadHuntSession());
  } catch (err) {
    console.warn('[magnet] hunt resume:', (err && err.message) || err);
  }

  const legacyPath = path.join(__dirname, '..', 'jobs', 'application-state.yaml');
  try {
    if (fs.existsSync(legacyPath) && !require('./lib/store/mode').isSupabase()) {
      const legacy = yaml.load(fs.readFileSync(legacyPath, 'utf8')) || {};
      const n = seedFromLegacyFlags(legacy.by_url || {});
      seedSubmitted(n);
      lifetimeTotals = loadState().totals;
    }
  } catch (_) {}

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 480,
    title: 'JobMagnet',
    backgroundColor: '#12141a',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.setMaxListeners(100);

  sidebarView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-sidebar.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chromeView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-chrome.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.addBrowserView(sidebarView);
  mainWindow.addBrowserView(chromeView);
  sidebarView.webContents.loadFile(path.join(__dirname, 'sidebar', 'index.html'));
  chromeView.webContents.loadFile(path.join(__dirname, 'chrome', 'index.html'));
  wireFlaggingKeys(sidebarView.webContents);
  wireFlaggingKeys(chromeView.webContents);
  ensureFooterView();
  ensureDrawerView();
  ensureDockView();
  ensureSplitterViews();

  timing.startSession();
  mainWindow.on('focus', () => timing.focus());
  mainWindow.on('blur', () => timing.blur());
  mainWindow.on('resize', () => {
    notifyShellPane();
    layout();
  });
  layout();

  let bootStarted = false;
  const startBoot = () => {
    if (bootStarted) return;
    bootStarted = true;
    setImmediate(bootJobTabs);
  };
  const sidebarWc = sidebarView.webContents;
  if (sidebarWc.isLoading()) {
    sidebarWc.once('did-finish-load', startBoot);
    sidebarWc.once('did-fail-load', startBoot);
  } else startBoot();

  app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

  fs.watch(JOBS_FILE, { persistent: false }, () => {
    try {
      reloadJobs();
    } catch (_) {}
  });
  if (MERGE_AI_SUBMISSIONS) {
    try {
      fs.watch(path.dirname(LEDGER_FILE), { persistent: false }, (_event, filename) => {
        if (filename && filename !== path.basename(LEDGER_FILE)) return;
        try {
          reloadJobs();
        } catch (_) {}
      });
    } catch (_) {}
    syncFromOriginAsync()
      .then((result) => {
        if (result && result.ok && (result.added || result.marked)) reloadJobs();
      })
      .catch(() => {});
  }
}

function writeJobRecord(url, patch) {
  const rec = writeRecord(url, patch);
  const status = (rec && rec.status) || (patch && patch.status);
  if (status) {
    for (const tab of tabs.values()) {
      if (tab.meta && tab.meta.url === url) tab.meta.status = status;
    }
  }
  return rec;
}

function settingsPayload() {
  const mail = mailStatus();
  return settings.snapshot(appSettings, { mail });
}

function modelPayload() {
  return models.snapshot(appSettings);
}

ipcMain.handle('magnet:settings-get', () => settingsPayload());
ipcMain.handle('magnet:settings-set', (_e, patch) => {
  const prevLang = currentUiLanguage();
  appSettings = settings.save(patch);
  notifyChrome();
  if (currentUiLanguage() !== prevLang) {
    installPageLanguageSession();
    reloadAtsViewsForLanguage();
  }
  return settingsPayload();
});
ipcMain.handle('magnet:models-get', async () => {
  await models.refreshCatalog();
  return modelPayload();
});
ipcMain.handle('magnet:models-set', async (_e, patch) => {
  appSettings = settings.save(patch);
  const tab = activeTabId && tabs.get(activeTabId);
  if (tab && tab.chatInFlight && tab.chatInFlight.text) {
    const again = tab.chatInFlight.text;
    tab.skipDraftCommit = true;
    cancelFill(tab);
    await agentClient.cancel(String(tab.meta.id));
    setTimeout(() => handleChatSend(tab.meta.id, again, [], { resume: true }), 0);
  }
  notifyChrome();
  return modelPayload();
});
ipcMain.on('magnet:activate', (_e, id) => activateTab(id));
let filterSaveTimer = null;
ipcMain.on('magnet:filters', (_e, f) => {
  sidebarFilter = sidebarFilters.normalize({ ...sidebarFilter, ...f });
  clearTimeout(filterSaveTimer);
  filterSaveTimer = setTimeout(() => {
    appSettings = settings.save({ sidebarFilters: sidebarFilter });
  }, 200);
  if (!tabBoot || tabBoot.done) return;
  prioritizeBoot(sidebarFilter);
  const matches = sidebarFilters.apply(tabBoot.pending, sidebarFilter).length;
  if (matches) releaseBootTabs(Math.min(SIDEBAR_BATCH, matches), tabBoot.entries);
});
ipcMain.on('magnet:tabs-more', () => {
  if (!tabBoot || tabBoot.done) return;
  releaseBootTabs(SIDEBAR_BATCH, tabBoot.entries);
});
ipcMain.handle('magnet:list', () => sidebarListPayload());
ipcMain.handle('magnet:nav-state', () => {
  const wc = activeWc();
  return {
    canGoBack: wc ? wc.canGoBack() : false,
    canGoForward: wc ? wc.canGoForward() : false,
    url: wc ? wc.getURL() : '',
  };
});
ipcMain.handle('magnet:chrome-active', () => {
  const tab = activeTabId && tabs.get(activeTabId);
  return chromePayload(tab);
});
ipcMain.handle('magnet:complete', (_e, id) => completeTab(id));
ipcMain.handle('magnet:pass', (_e, id) => passTab(id));
ipcMain.handle('magnet:undo-outcome', () => undoOutcome());
ipcMain.handle('magnet:autofill', (_e, id) => startAutofill(id));
ipcMain.handle('magnet:all', (_e, id) => startAll(id));
ipcMain.handle('magnet:cancel', (_e, id) => cancelFillJob(id));
ipcMain.handle('magnet:jd', (_e, id) => startJd(id));
ipcMain.handle('magnet:fill', (_e, id) => startFill(id));
ipcMain.handle('magnet:essays', (_e, id) => startEssays(id));
ipcMain.handle('magnet:review-cancel', (_e, { id, stop }) => {
  const tab = tabs.get(id);
  const out = cancelReview(tab, { stop: Boolean(stop) });
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:voice-get', () => {
  try {
    graph.ensureOpen();
    graph.seedVoiceFromFile(loadRichboi());
    const row = graph.currentVoice();
    return (row && row.text) || currentRichboi();
  } catch (_) {
    return currentRichboi();
  }
});
ipcMain.handle('magnet:voice-set', (_e, text) => {
  queueRichboi(text);
  return { ok: true };
});
ipcMain.handle('magnet:voice-flush', (_e, text) => {
  if (text != null) richboiPending = String(text);
  return { ok: true, text: flushRichboi() };
});
ipcMain.handle('magnet:voice-save', (_e, text) => {
  const row = saveUserVoice(text != null ? text : currentRichboi());
  richboiPending = null;
  return { ok: true, id: row && row.id, kind: row && row.kind, text: row && row.text };
});
ipcMain.handle('magnet:voice-history', () => {
  graph.ensureOpen();
  return { versions: graph.voiceHistory(40), pending: graph.pendingRules() };
});
ipcMain.handle('magnet:voice-revert', (_e, id) => {
  const row = revertVoice(id);
  if (row) richboiPending = null;
  return { ok: Boolean(row), text: row && row.text, id: row && row.id };
});
ipcMain.handle('magnet:voice-accept-pending', () => {
  const row = acceptPending();
  if (row) richboiPending = null;
  return { ok: Boolean(row), text: row && row.text };
});
ipcMain.handle('magnet:voice-pending', () => {
  graph.ensureOpen();
  return { pending: graph.pendingRules() };
});
ipcMain.handle('magnet:system-prompt-get', () => currentSystemPrompt());
ipcMain.handle('magnet:system-prompt-set', (_e, text) => {
  queueSystemPrompt(text);
  return { ok: true };
});
ipcMain.handle('magnet:system-prompt-flush', (_e, text) => {
  if (text != null) systemPromptPending = String(text);
  return { ok: true, text: flushSystemPrompt() };
});
ipcMain.handle('magnet:essay-fill', (_e, { id, fieldIds, instruction }) =>
  startEssays(id, { fieldIds, instruction })
);
async function handleChatSend(id, text, fieldIds, opts = {}) {
  const tab = tabs.get(id) || tabByChatKey(id);
  const instruction = String(text || '').trim();
  if (!tab || !instruction) return { ok: false, error: 'empty' };
  if (tab.autofillStatus === 'running') return { ok: false, error: 'busy' };
  if (tab.debrief && tab.debrief.status === 'thinking') return { ok: false, error: 'busy' };
  const ids =
    Array.isArray(fieldIds) && fieldIds.length
      ? fieldIds
      : tab.chatTarget && tab.chatTarget.id
        ? [tab.chatTarget.id]
        : [];
  tab.chat = Array.isArray(tab.chat) ? tab.chat : [];
  const youAt = opts.resume && tab.chatInFlight ? tab.chatInFlight.at : Date.now();
  if (!opts.resume) {
    tab.chat.push({ role: 'you', text: instruction, at: youAt, fieldIds: ids });
    persistChat(tab);
    notifyChrome();
  }
  persistUi(chatTabs.bumpTab(chatUi, tab.meta.url));
  openChatDrawer(tab);
  if (tab.debrief && tab.debrief.status === 'open') {
    return handleDebriefSend(tab, instruction);
  }
  if (!tab.fillCancelRequested) tab.skipDraftCommit = false;
  attachFillAbort(tab);
  tab.chatStream = { text: '', stage: 'Thinking…', drafts: [] };
  tab.chatInFlight = { text: instruction, at: youAt };
  sendChatDelta(tab);
  let result;
  try {
    if (tab.fillCancelRequested || (tab.fillAbort && tab.fillAbort.signal.aborted)) {
      tab.fillCancelRequested = false;
      tab.fillAbort = null;
      result = { ok: true, cancelled: true };
    } else {
      result = await startEssays(id, { fieldIds: ids, instruction, skipChatLog: true });
    }
  } finally {
    tab.chatInFlight = null;
    tab.chatStream = null;
  }
  let reply = (result && result.reply) || '';
  if (!reply) {
    if (result && result.empty && !instruction) reply = 'No essay fields on this page.';
    else if (tab.essayError) reply = essayFailDetail(tab.essayError);
    else if (result && result.cancelled) reply = '';
    else reply = 'Okay.';
  }
  const folds = chatFolds(result, tab);
  const youMsg = tab.chat.find((m) => m.role === 'you' && m.at === youAt);
  if (youMsg && result && result.sent) {
    youMsg.sent = result.sent;
    youMsg.drafts = sentDraftsFrom(result);
  }
  if (!(result && result.cancelled && !reply)) {
    tab.chat.push({
      role: 'magnet',
      text: reply,
      drafts: (result && result.drafts) || [],
      folds,
      tools: (result && result.tools) || [],
      asks: (result && result.asks) || [],
      received: (result && result.received && result.received.error ? null : (result && result.received) || null),
      at: Date.now(),
    });
  }
  appendAlertBubble(tab, (result && result.alerts) || []);
  persistChat(tab);
  notifyChrome();
  return result;
}
ipcMain.handle('magnet:chat-send', (_e, { id, text, fieldIds }) => handleChatSend(id, text, fieldIds));
ipcMain.handle('magnet:upload-resume', (_e, id) => startUploadResume(id));
ipcMain.handle('magnet:pick-resume', (_e, { id, resumeId }) => {
  const tab = tabs.get(id);
  if (!tab) return { ok: false };
  tab.resumeOverride = resumeId;
  tab.resume = pickResume(tab.meta, resumeId);
  notifyChrome();
  return { ok: true, resume: tab.resume };
});
ipcMain.handle('magnet:clipboard-write', (_e, text) => {
  clipboard.writeText(String(text || ''));
  return { ok: true };
});
ipcMain.handle('magnet:jd-clipboard', (_e, id) => {
  const tab = tabs.get(id);
  const text = htmlToJdText(clipboard.readText());
  tab.jd = {
    text,
    source: 'clipboard',
    captured_at: new Date().toISOString(),
    findings: scanJobDescription(text),
  };
  tab.jdVerified = looksLikeJobDescription(text);
  persistTabJd(tab);
  selectJobPage(tab, 'jd');
  noticeCompletion(tab, 'jd', { ok: true, jd: tab.jd });
  return tab.jd;
});
ipcMain.on('magnet:back', () => {
  const wc = activeWc();
  if (wc && wc.canGoBack()) wc.goBack();
});
ipcMain.on('magnet:forward', () => {
  const wc = activeWc();
  if (wc && wc.canGoForward()) wc.goForward();
});
ipcMain.on('magnet:reload', () => {
  const wc = activeWc();
  if (wc) wc.reload();
});
ipcMain.on('magnet:home', () => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (tab && tab.atsView) loadPageUrl(tab.atsView.webContents, tab.homeUrl);
});
ipcMain.on('magnet:go', (_e, raw) => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab) return;
  let url = String(raw || '').trim();
  if (!url) return;
  if (!/^(https?:|file:)/i.test(url)) url = 'https://' + url;
  ensureAtsView(tab);
  tab.mode = 'ats';
  loadPageUrl(tab.atsView.webContents, url);
  if (isCompactLayout()) setShellPane('apply', { relayout: false });
  layout();
});
ipcMain.on('magnet:ingest-open', () => openIngest());
ipcMain.on('magnet:ingest-close', () => closeIngest());
ipcMain.on('magnet:chrome-chips', (_e, open) => {
  chromeChipsOpen = Boolean(open);
  layout();
});
ipcMain.handle('magnet:ingest', async (_e, message) => handleIngestMessage(message));
ipcMain.handle('magnet:ingest-send', async (_e, message) => handleIngestMessage(message));
ipcMain.handle('magnet:ingest-approve', async (_e, schema) => {
  ingestChat = Array.isArray(ingestChat) ? ingestChat : [];
  ingestChat.push({ role: 'you', text: 'Approve search plan', at: Date.now() });
  ingestChat = trimChat(ingestChat);
  persistIngestChat();
  return handleIngestApprove(schema);
});
ipcMain.handle('magnet:ingest-answer', async (_e, payload) => {
  const asks = (payload && payload.asks) || [];
  const answers = (payload && payload.answers) || {};
  const userText = (ingestChat || [])
    .filter((m) => m && m.role === 'you')
    .map((m) => m.text)
    .join('\n');
  const story = await resolveStoryAsks(asks, answers, { userText, source: 'chat' });
  if (story.handled) {
    for (const a of asks) {
      if (a && a.kind === 'story-confirm') a.answered = true;
    }
    if (story.onlyStories) {
      ingestChat = Array.isArray(ingestChat) ? ingestChat : [];
      ingestChat.push({ role: 'magnet', text: story.reply, at: Date.now() });
      persistIngestChat();
      notifyChrome();
      return { ok: true, reply: story.reply };
    }
  }
  const rest = asks.filter((a) => a && a.kind !== 'story-confirm');
  const text = formatAskAnswers(rest, answers);
  if (!text) return story.handled ? { ok: true, reply: story.reply } : { ok: false, reply: 'Empty.' };
  return handleIngestMessage(text);
});
ipcMain.handle('magnet:hunt-login', async (_e, action) => {
  if (String(action) === 'skip') {
    resolveHuntLogin({ skipped: true });
    huntPush('Skipping this site.');
    return { ok: true, skipped: true };
  }
  huntPush('Checking whether you are signed in…');
  return { ok: true };
});
ipcMain.handle('magnet:chat-answer', async (_e, { id, asks, answers }) => {
  const tab = tabs.get(id) || tabByChatKey(id);
  const userText = ((tab && tab.chat) || [])
    .filter((m) => m && m.role === 'you')
    .map((m) => m.text)
    .join('\n');
  const story = await resolveStoryAsks(asks || [], answers || {}, { userText, source: 'chat' });
  if (story.handled) {
    for (const a of asks || []) {
      if (a && a.kind === 'story-confirm') a.answered = true;
    }
    if (tab && story.onlyStories) {
      tab.chat = Array.isArray(tab.chat) ? tab.chat : [];
      tab.chat.push({ role: 'magnet', text: story.reply, at: Date.now() });
      persistChat(tab);
      notifyChrome();
      return { ok: true, reply: story.reply };
    }
  }
  const rest = (asks || []).filter((a) => a && a.kind !== 'story-confirm');
  const text = formatAskAnswers(rest, answers || {});
  if (!text) return story.handled ? { ok: true, reply: story.reply } : { ok: false, error: 'empty' };
  return handleChatSend(id, text);
});
ipcMain.handle('magnet:process-get', () => {
  const tab = activeTabId && tabs.get(activeTabId);
  return tab ? processPayload(tab) : null;
});
ipcMain.handle('magnet:process-rejected', (_e, note) => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab) return { ok: false };
  const snap = outcomeUndo.snapshotRecord(getRecord(tab.meta.url));
  appendEvent(tab.meta.url, { type: 'rejected', title: 'Rejected', body: note || '' });
  bumpCount('rejected');
  notifySidebar();
  notifyDash();
  armOutcomeUndo({
    id: tab.meta.id,
    kind: 'rejected',
    snap,
    name: tab.meta.name,
  });
  return processPayload(tab);
});
ipcMain.handle('magnet:process-event', (_e, event) => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab) return { ok: false };
  appendEvent(tab.meta.url, event);
  notifySidebar();
  return processPayload(tab);
});
ipcMain.handle('magnet:process-notes', (_e, prep_notes) => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab) return { ok: false };
  const rec = getRecord(tab.meta.url);
  writeJobRecord(tab.meta.url, { ...rec, prep_notes });
  return processPayload(tab);
});
ipcMain.handle('magnet:process-contact', (_e, contact) => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab) return { ok: false };
  const rec = getRecord(tab.meta.url);
  rec.contacts = [...(rec.contacts || []), { id: 'c' + Date.now(), ...contact }];
  writeJobRecord(tab.meta.url, rec);
  return processPayload(tab);
});
ipcMain.handle('magnet:mail-connect', () => connectGmail());
ipcMain.handle('magnet:mail-signout', () => signOutGmail());
ipcMain.handle('magnet:mail-scan', () => runMailScan());
ipcMain.handle('magnet:command', (_e, { name, payload }) => {
  if (!magnetApp) return { ok: false, error: 'Magnet core not ready' };
  return magnetApp.dispatch(name, payload || {});
});
ipcMain.handle('magnet:essay-log', (_e, opts) => {
  const { listEssays } = require('./lib/essay-browser');
  return listEssays(opts || {});
});
ipcMain.handle('magnet:essay-log-open', () => openEssayLog());
ipcMain.handle('magnet:insights-open', () => openInsights('insights'));
ipcMain.handle('magnet:library-open', () => openInsights('library'));
ipcMain.handle('magnet:data-page', (_e, page) => openInsights(page));
ipcMain.handle('magnet:insights-get', () => insightsView());
ipcMain.handle('magnet:insights-save', (_e, config) => insightsView(config));
ipcMain.handle('magnet:library-catalog', () => {
  try {
    return require('./lib/library').catalog();
  } catch (err) {
    console.warn('[magnet] library:', (err && err.message) || err);
    return { error: (err && err.message) || 'Library failed' };
  }
});
ipcMain.handle('magnet:library-query', (_e, query) => {
  try {
    return require('./lib/library').query(query || {});
  } catch (err) {
    console.warn('[magnet] library:', (err && err.message) || err);
    return { error: (err && err.message) || 'Library failed' };
  }
});
ipcMain.handle('magnet:library-read', (_e, query) => {
  try {
    return require('./lib/library').read(query || {});
  } catch (err) {
    console.warn('[magnet] library:', (err && err.message) || err);
    return { error: (err && err.message) || 'Library failed' };
  }
});
ipcMain.handle('magnet:library-write', (_e, payload) => {
  try {
    return require('./lib/library').write(payload || {});
  } catch (err) {
    console.warn('[magnet] library:', (err && err.message) || err);
    return { error: (err && err.message) || 'Library failed' };
  }
});
ipcMain.handle('magnet:import-resume', () => importResumeDialog());
ipcMain.handle('magnet:export-bundle', async () => {
  if (!magnetApp) return { ok: false, error: 'Magnet core not ready' };
  const { bundle } = magnetApp.exportBundle();
  const destDir = path.join(__dirname, 'knowledge', 'export');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'magnet-bundle.json');
  fs.writeFileSync(dest, JSON.stringify(bundle, null, 2));
  const save = await dialog.showSaveDialog(mainWindow, {
    title: 'Export JobMagnet bundle',
    defaultPath: path.join(app.getPath('documents'), 'magnet-bundle.json'),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!save.canceled && save.filePath) fs.copyFileSync(dest, save.filePath);
  return { ok: true, path: save.filePath || dest, reply: 'Bundle exported.' };
});
ipcMain.handle('magnet:import-bundle', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Import JobMagnet bundle',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
  const bundle = JSON.parse(fs.readFileSync(picked.filePaths[0], 'utf8'));
  const out = magnetApp.importBundle({ bundle });
  reloadJobs();
  return { ok: true, ...out, reply: `Imported ${out.jobs || 0} jobs.` };
});
ipcMain.handle('magnet:mail-resolve', (_e, payload) => {
  const out = resolveQueue(payload && payload.id, payload && payload.action);
  if (out.ok) applyMailResolves(out);
  if (payload && payload.id) {
    for (const tab of tabs.values()) {
      tab.chat = markMailRead(tab.chat, payload.id);
      persistChat(tab);
    }
  }
  notifySidebar();
  notifyChrome();
  const tab = activeTabId && tabs.get(activeTabId);
  return tab ? { ...out, ...processPayload(tab) } : out;
});
ipcMain.handle('magnet:notice-open', (_e, notice) => {
  const mailId = notice && notice.mailId;
  const jobId = notice && notice.jobId;
  const url = notice && notice.url;
  let tab = (jobId && tabs.get(jobId)) || [...tabs.values()].find((t) => t.meta.url === url);
  if (tab && mailId) {
    tab.chat = markMailRead(tab.chat, mailId);
    persistChat(tab);
  } else if (url && mailId) {
    saveChat(url, markMailRead(loadChat(url), mailId), {});
  }
  if (tab) {
    activateTab(tab.meta.id);
    openChatDrawer(tab);
  } else if (notice && notice.href && /^https?:\/\//i.test(String(notice.href))) {
    shell.openExternal(notice.href);
  }
  notifySidebar();
  notifyChrome();
  return { ok: true, notices: sidebarNotices() };
});
ipcMain.handle('magnet:process-overflow', (_e, action) => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab) return { ok: false };
  if (action === 'withdrawn') appendEvent(tab.meta.url, { type: 'withdrawn', title: 'Withdrawn' });
  if (action === 'back-submitted') writeJobRecord(tab.meta.url, { ...getRecord(tab.meta.url), status: 'submitted' });
  if (action === 'back-open') {
    writeJobRecord(tab.meta.url, { ...getRecord(tab.meta.url), status: 'open' });
    tab.mode = 'ats';
    ensureAtsView(tab);
  }
  notifySidebar();
  layout();
  return processPayload(tab);
});
function showPostingPage() {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab) return;
  tab.mode = 'ats';
  const view = ensureAtsView(tab);
  const posting = tab.meta.posting || tab.meta.linkedin;
  if (posting) loadPageUrl(view.webContents, posting);
  layout();
  notifyChrome();
}

ipcMain.on('magnet:open-posting', () => showPostingPage());
ipcMain.on('magnet:open-jd-page', () => showPostingPage());
ipcMain.on('magnet:drawer', (_e, which) => {
  const next = chatTabs.asPageSubtab(which);
  const convTab = tabByChatKey(activeChatKey());
  if (convTab) selectJobPage(convTab, next);
  else {
    openDrawer(next);
    notifyChrome();
  }
});
ipcMain.on('magnet:chat-select', (_e, key) => {
  selectConversation(key);
  notifySidebar();
  layout();
  notifyChrome();
});
ipcMain.on('magnet:chat-open-job', (_e, idOrKey) => {
  const tab = tabs.get(idOrKey) || tabByChatKey(idOrKey);
  if (!tab) return;
  selectConversation(tab.meta.url, { forceOpen: true });
  notifySidebar();
  layout();
  notifyChrome();
});
ipcMain.on('magnet:shell-pane', (_e, pane) => setShellPane(pane));
ipcMain.handle('magnet:shell-pane', () => ({ pane: shellPane, compact: isCompactLayout() }));
function tabForAtsContents(wc) {
  if (!wc) return null;
  for (const tab of tabs.values()) {
    if (tab.atsView && tab.atsView.webContents === wc) return tab;
  }
  return activeTabId ? tabs.get(activeTabId) : null;
}

function persistEssayMirror(e, payload) {
  const tab = tabForAtsContents(e && e.sender);
  return applyMirrorSave(tab, payload);
}

ipcMain.on('magnet:mirror', persistEssayMirror);
ipcMain.handle('magnet:mirror', persistEssayMirror);
async function handleDebugFlag(tab, fieldId, flagName, correction) {
  if (!tab || !tab.atsView) return { ok: false };
  const out = await retryField(tab.atsView.webContents, tab, fieldId, flagName, correction);
  if (out && out.open_review) {
    openFlagReview(tab, out);
    selectJobPage(tab, 'debug');
    notifyChrome();
    return out;
  }
  if (out && out.learned) {
    toast('Learned ' + String(out.value || '').slice(0, 48));
  } else if (!out || !out.ok) {
    toast('Retry failed' + (out && (out.error || (out.result && out.result.reason)) ? ': ' + (out.error || out.result.reason) : ''));
  }
  notifyChrome();
  return out;
}

ipcMain.handle('magnet:debug-flag', async (_e, { id, fieldId, flag: flagName, correction }) => {
  return handleDebugFlag(tabs.get(id), fieldId, flagName, correction);
});
ipcMain.handle('magnet:debug-flag-active', async (_e, { fieldId, flag: flagName, correction }) => {
  return handleDebugFlag(activeTabId && tabs.get(activeTabId), fieldId, flagName, correction);
});
ipcMain.handle('magnet:review-retry', async (_e, { id, fieldId, strategy, value, flag, label }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  const out = await retryReviewField(tab.atsView.webContents, tab, { fieldId, strategy, value, flag, label });
  if (out && out.open_review) {
    openFlagReview(tab, out);
    selectJobPage(tab, 'debug');
  }
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:review-accept', async (_e, { id, fieldId, value, steps, label, skip, classId }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  const out = await acceptReviewFill(tab.atsView.webContents, tab, { fieldId, value, steps, label, skip, classId });
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:review-learn-steps', async (_e, { id, fieldId, steps, value }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  const out = await learnReviewSteps(tab.atsView.webContents, tab, { fieldId, steps, value });
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:review-record-start', async (_e, { id, fieldId }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  const out = await startFillRecord(tab.atsView.webContents, tab, { fieldId });
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:review-record-stop', async (_e, { id, fieldId }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  const out = await stopFillRecord(tab.atsView.webContents, tab, { fieldId });
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:review-record-confirm', async (_e, { id, fieldId }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  const out = await confirmFillRecord(tab.atsView.webContents, tab, { fieldId });
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:review-learn-recipe', async (_e, { id, recipeId, accept, value }) => {
  const tab = tabs.get(id);
  if (!tab) return { ok: false };
  const wc = tab.atsView && tab.atsView.webContents;
  const out = await acceptReviewRecipe(wc, tab, { recipeId, accept: accept !== false, value });
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:review-run', async (_e, { id, fieldId, source, save, saveWithoutVerify }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  const out = await acceptReviewRun(tab.atsView.webContents, tab, { fieldId, source, save, saveWithoutVerify });
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:review-rewrite', async (_e, { id, fieldId, instruction }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  const out = await rewriteReviewRun(tab.atsView.webContents, tab, { fieldId, instruction });
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:review-answer', async (_e, { id, askId, answer }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  const out = await answerReviewAsk(tab.atsView.webContents, tab, { id: askId, answer });
  notifyChrome();
  return out;
});
ipcMain.handle('magnet:review-chat', async (_e, { id, fieldId, text }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  tab.reviewFieldChats = {
    ...(tab.reviewFieldChats || {}),
    [fieldId]: { you: String(text || '').trim(), reply: '', busy: true, error: '' },
  };
  notifyChrome();
  const out = await reviewFieldChat(tab.atsView.webContents, tab, { fieldId, text });
  notifyChrome();
  return out;
});
ipcMain.on('magnet:harvest', async (_e, payload) => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab || !tab.atsView || !payload) return;
  const field = (tab.debugFields || []).find((f) => f.id === payload.id);
  if (field && field.route === 'needs_llm') return;
  if (tab.fillRecord && tab.fillRecord.status === 'recording' && tab.fillRecord.fieldId === payload.id) return;
  await harvestStaticField(tab.atsView.webContents, tab, payload);
  notifyChrome();
});
ipcMain.on('magnet:field-focus', (_e, payload) => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab || !payload) return;
  applyFocusEvent(tab, payload);
  if (tab.debugFields && tab.debugFields.length) clearIfMissing(tab, tab.debugFields);
  notifyChrome();
});
ipcMain.handle('magnet:chat-cancel', async (_e, id) => {
  if (chatTabs.isIngest(id)) return cancelIngest();
  const tab = tabs.get(id) || tabByChatKey(id);
  if (!tab) return { ok: false };
  tab.skipDraftCommit = true;
  tab.chatStream = null;
  cancelFill(tab);
  try {
    await agentClient.cancel(String(tab.meta.id));
  } catch (_) {}
  notifyChrome();
  return { ok: true };
});
ipcMain.handle('magnet:chat-target-clear', (_e, id) => {
  const tab = tabs.get(id);
  if (!tab) return { ok: false };
  dismissChatTarget(tab);
  notifyChrome();
  return { ok: true };
});
ipcMain.handle('magnet:chat-expand', (_e, id) => {
  const tab = tabs.get(id);
  if (!tab) return { ok: false };
  const last = [...(tab.chat || [])].reverse().find((m) => m.role === 'you');
  const out = expandThread(tab, {
    company: tab.meta && tab.meta.name,
    title: tab.meta && tab.meta.title,
    jd: tab.jd,
    fields: tab.debugFields || [],
    leftovers: [],
  }, (last && last.text) || '');
  tab.chat = out.kept;
  tab.chatFolded = out.folded;
  tab.agentNeedsRebuild = true;
  persistChat(tab);
  notifyChrome();
  return { ok: true, folded: (tab.chatFolded || []).length };
});
ipcMain.handle('magnet:chat-draft-cancel', (_e, id) => {
  const tab = tabs.get(id);
  if (!tab) return { ok: false };
  tab.skipDraftCommit = true;
  tab.chatStream = null;
  cancelFill(tab);
  notifyChrome();
  return { ok: true };
});
ipcMain.handle('magnet:debug-focus', async (_e, { id, fieldId }) => {
  const tab = tabs.get(id);
  if (!tab || !tab.atsView) return { ok: false };
  tab.reviewFocus = fieldId || '';
  tab.reviewFlashId = fieldId || '';
  tab.reviewFlashAt = Date.now();
  if (fieldId) {
    await evalFirstOk(tab.atsView.webContents, flashFieldScript(fieldId));
  }
  return { ok: true };
});
ipcMain.on('magnet:copy-url', () => {
  const wc = activeWc();
  if (wc) clipboard.writeText(wc.getURL());
  toast('Copied URL');
});
ipcMain.on('magnet:zoom-in', () => {
  const wc = activeWc();
  if (wc) wc.setZoomLevel(wc.getZoomLevel() + 0.5);
});
ipcMain.on('magnet:zoom-out', () => {
  const wc = activeWc();
  if (wc) wc.setZoomLevel(wc.getZoomLevel() - 0.5);
});
ipcMain.on('magnet:open-external', () => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (tab) shell.openExternal(tab.meta.url);
});
ipcMain.on('magnet:show-dashboard', () => {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab) return;
  tab.mode = 'dashboard';
  ensureDashView(tab);
  layout();
  notifyChrome();
});
ipcMain.on('magnet:open-mail', (_e, href) => {
  const url = String(href || '').trim();
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});
ipcMain.on('magnet:find-query', (_e, opts) => {
  runFind(opts);
});
ipcMain.on('magnet:find-close', () => {
  closeFindBar();
});
ipcMain.on('magnet:split-start', (e, payload) => {
  if (!mainWindow || isCompactLayout()) {
    e.returnValue = false;
    return;
  }
  const [width] = mainWindow.getContentSize();
  const which = splitRight && e.sender === splitRight.webContents ? 'drawer' : 'sidebar';
  splitDrag = {
    which,
    originX: Number(payload && payload.screenX) || 0,
    originSidebar: sidebarWidth,
    originDrawer: drawerWidth,
    windowWidth: width,
  };
  layout();
  e.returnValue = true;
});
ipcMain.on('magnet:split-move', (_e, payload) => {
  if (!splitDrag || !mainWindow) return;
  const [width] = mainWindow.getContentSize();
  const next = shellLayout.applySplitDrag({
    which: splitDrag.which,
    originX: splitDrag.originX,
    originSidebar: splitDrag.originSidebar,
    originDrawer: splitDrag.originDrawer,
    screenX: Number(payload && payload.screenX) || 0,
    windowWidth: width,
  });
  sidebarWidth = next.sidebar;
  drawerWidth = next.drawer;
  layout();
});
ipcMain.on('magnet:split-end', () => {
  if (!splitDrag) return;
  splitDrag = null;
  appSettings = settings.save({ sidebarWidth, drawerWidth });
  layout();
});

app.on('web-contents-created', (_e, wc) => {
  attachContextMenu(wc, {
    Menu,
    clipboard,
    shell,
    getWindow: (contents) => BrowserWindow.fromWebContents(contents) || mainWindow,
  });
  wc.on('before-input-event', (event, input) => {
    if (handleCtrlTab(event, input, wc)) return;
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    const key = String(input.key || '').toLowerCase();
    if (mod && key === 'w') event.preventDefault();
    if (mod && key === 'l') {
      event.preventDefault();
      focusUrlBar();
    }
    if (mod && key === 'f') {
      event.preventDefault();
      openFindBar();
    }
    if (key === 'escape' && findBarOpen) {
      event.preventDefault();
      closeFindBar();
    }
  });
});

app.whenReady().then(() => {
  loadDotEnv();
  try {
    magnetApp = createElectronMagnet({
      getTab: (id) => tabs.get(id),
      evalFirstOk,
      setFileInput,
      connectMail: connectGmail,
      signOutMail: signOutGmail,
    });
  } catch (err) {
    console.warn('[magnet] core:', (err && err.message) || err);
  }
  try {
    agentClient.ensureHost();
  } catch (err) {
    console.warn('[magnet] agent host:', (err && err.message) || err);
  }
  models.refreshCatalog().then(() => notifyChrome()).catch(() => {});
  createWindow();
  startControlApi();
});

app.on('before-quit', () => {
  timing.endSession();
  try {
    flushStrategy();
  } catch (_) {}
  agentClient.shutdown();
  try {
    if (!require('./lib/store/mode').isSupabase()) persist.exportLiveYaml();
  } catch (_) {}
});
app.on('window-all-closed', () => app.quit());
