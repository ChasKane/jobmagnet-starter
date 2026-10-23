const listEl = document.getElementById('tab-list');
const apiHint = document.getElementById('api-hint');
const lifetimeEl = document.getElementById('lifetime');
const noticeBtn = document.getElementById('notice-btn');
const noticeBadge = document.getElementById('notice-badge');
const noticePop = document.getElementById('notice-pop');
const noticeList = document.getElementById('notice-list');
const insightsBtn = document.getElementById('insights-btn');
const essayLogBtn = document.getElementById('essay-log-btn');
const settingsBtn = document.getElementById('settings-btn');
const backBtn = document.getElementById('nav-back');
const forwardBtn = document.getElementById('nav-forward');
const reloadBtn = document.getElementById('nav-reload');
const homeBtn = document.getElementById('nav-home');
const navUrl = document.getElementById('nav-url');
const searchEl = document.getElementById('search');
const filterStatus = document.getElementById('filter-status');
const filterYoe = document.getElementById('filter-yoe');
const filterLevel = document.getElementById('filter-level');
const filterSort = document.getElementById('filter-sort');
const filterCount = document.getElementById('filter-count');
const sidebarFilters = window.sidebarFilters;
const settingsDialog = document.getElementById('settings-dialog');
const settingsClose = document.getElementById('settings-close');
const settingsForm = document.getElementById('settings-form');
const voiceText = document.getElementById('voice-text');
const voiceSaveBtn = document.getElementById('voice-save');
const voiceHistoryBtn = document.getElementById('voice-history');
const voiceHistoryModal = document.getElementById('voice-history-modal');
const voiceHistoryList = document.getElementById('voice-history-list');
const voiceHistoryClose = document.getElementById('voice-history-close');
const voicePendingBadge = document.getElementById('voice-pending-badge');
const voiceAcceptPending = document.getElementById('voice-accept-pending');
const systemPromptEl = document.getElementById('system-prompt');
const systemPromptEdit = document.getElementById('system-prompt-edit');

let allTabs = [];
let notices = [];
let controlPort = null;
let totals = { submitted: 0 };
let session = { submitted: 0 };
let pinnedActiveId = null;

function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || '')
    .join('')
    .toUpperCase();
}

function renderNav(state) {
  if (!state) return;
  backBtn.disabled = !state.canGoBack;
  forwardBtn.disabled = !state.canGoForward;
  if (document.activeElement !== navUrl) navUrl.value = state.url || '';
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );
}

function currentFilters() {
  const raw = {
    status: filterStatus.value,
    yoe: filterYoe.value,
    level: filterLevel.value,
    q: searchEl.value || '',
    sort: filterSort ? filterSort.value : 'updated',
  };
  return sidebarFilters ? sidebarFilters.normalize(raw) : raw;
}

function ensureOption(select, value) {
  if (!select || !value || value === 'all') return;
  if ([...select.options].some((o) => o.value === value)) return;
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = value;
  select.appendChild(opt);
}

function applyFilters(f) {
  if (!f) return;
  const next = sidebarFilters ? sidebarFilters.normalize(f) : f;
  if (searchEl) searchEl.value = next.q || '';
  if (filterStatus && [...filterStatus.options].some((o) => o.value === next.status)) filterStatus.value = next.status;
  if (filterSort && [...filterSort.options].some((o) => o.value === next.sort)) filterSort.value = next.sort;
  ensureOption(filterYoe, next.yoe);
  ensureOption(filterLevel, next.level);
  if (filterYoe) filterYoe.value = next.yoe;
  if (filterLevel) filterLevel.value = next.level;
}

function rebuildFilterOptions() {
  const keepYoe = filterYoe.value;
  const keepLevel = filterLevel.value;
  filterYoe.innerHTML = '<option value="all">All</option>';
  for (const v of uniqueSorted(allTabs.map((t) => t.yoe))) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    filterYoe.appendChild(opt);
  }
  filterLevel.innerHTML = '<option value="all">All</option>';
  for (const v of uniqueSorted(allTabs.map((t) => t.level))) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    filterLevel.appendChild(opt);
  }
  ensureOption(filterYoe, keepYoe);
  ensureOption(filterLevel, keepLevel);
  if ([...filterYoe.options].some((o) => o.value === keepYoe)) filterYoe.value = keepYoe;
  if ([...filterLevel.options].some((o) => o.value === keepLevel)) filterLevel.value = keepLevel;
}

function filteredTabs() {
  if (sidebarFilters) return sidebarFilters.apply(allTabs, currentFilters());
  return allTabs.slice();
}

function applyRowState(row, tab) {
  row.className =
    'tab-row' +
    (tab.active ? ' active' : '') +
    (tab.bucket === 'submitted' ? ' submitted' : '') +
    (tab.bucket === 'rejected' || tab.bucket === 'passed' ? ' rejected' : '');
  const fillBtn = row.querySelector('.tab-autofill');
  if (fillBtn) {
    fillBtn.textContent = tab.autofillStatus === 'running' ? '…' : '✎';
    fillBtn.disabled = tab.autofillStatus === 'running' || tab.bucket !== 'open';
  }
}

function rowSig(tab) {
  return [tab.id, tab.name, tab.title, tab.status, tab.bucket, tab.logo, tab.salary, tab.yoe, tab.level, tab.updatedAt].join('|');
}

function pinActiveRow(activeId) {
  if (!activeId || activeId === pinnedActiveId) return;
  pinnedActiveId = activeId;
  const active = listEl.querySelector('.tab-row.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function rowEl(tab) {
  const row = document.createElement('div');
  row.dataset.id = tab.id;
  row.dataset.sig = rowSig(tab);
  applyRowState(row, tab);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tab';
  btn.title = tab.url;
  if (tab.logo) {
    const img = document.createElement('img');
    img.className = 'logo';
    img.src = tab.logo;
    img.alt = '';
    img.addEventListener('error', () => img.replaceWith(fallbackLogo(tab.name)));
    btn.appendChild(img);
  } else {
    btn.appendChild(fallbackLogo(tab.name));
  }
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = tab.name;
  if (tab.status && tab.status !== 'open') {
    const mark = document.createElement('span');
    mark.className = tab.bucket === 'submitted' ? 'submitted-mark' : 'rejected-mark';
    mark.textContent = tab.bucket === 'submitted' ? ' ✓' : ' · ' + tab.status;
    name.appendChild(mark);
  }
  btn.appendChild(name);
  const sub = document.createElement('div');
  sub.className = 'host';
  const chips = [tab.title, tab.salary, tab.yoe, tab.level, tab.ai ? 'AI' : '', ...(tab.industries || []).slice(0, 2)]
    .filter(Boolean)
    .join(' · ');
  sub.textContent = chips || tab.hostname || '';
  btn.appendChild(sub);
  btn.addEventListener('click', () => window.magnet.activate(tab.id));
  const fillBtn = document.createElement('button');
  fillBtn.type = 'button';
  fillBtn.className = 'tab-autofill';
  fillBtn.textContent = tab.autofillStatus === 'running' ? '…' : '✎';
  fillBtn.disabled = tab.autofillStatus === 'running' || tab.bucket !== 'open';
  fillBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fillBtn.blur();
    window.magnet.autofill(tab.id).catch(console.error);
  });
  row.appendChild(btn);
  row.appendChild(fillBtn);
  return row;
}

let tabsPending = 0;
let moreAsked = false;
let moreShown = -1;

function listNeedsMore() {
  if (!tabsPending || !listEl) return false;
  const near = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 320;
  const short = listEl.scrollHeight <= listEl.clientHeight + 8;
  return near || short;
}

function maybeMoreTabs() {
  if (!listNeedsMore() || !window.magnet || !window.magnet.moreTabs) {
    moreAsked = false;
    return;
  }
  const shown = filteredTabs().length;
  if (moreAsked && shown === moreShown) return;
  moreAsked = true;
  moreShown = shown;
  window.magnet.moreTabs();
}

function renderList() {
  const tabs = filteredTabs();
  if (controlPort != null) apiHint.textContent = `API :${controlPort}`;
  const life = totals.submitted || 0;
  const today = (session && session.submitted) || 0;
  lifetimeEl.textContent = `${today} / ${life}`;
  lifetimeEl.title = `${today} this session · ${life} lifetime submits`;
  const total = allTabs.length + (tabsPending || 0);
  filterCount.textContent = `${tabs.length} / ${total}`;
  const keepScroll = listEl.scrollTop;
  const activeId = (tabs.find((tab) => tab.active) || {}).id || null;
  const ids = tabs.map((t) => t.id);
  const rows = [...listEl.querySelectorAll('.tab-row')];
  if (
    rows.length === ids.length &&
    rows.every((row, i) => row.dataset.id === ids[i] && row.dataset.sig === rowSig(tabs[i]))
  ) {
    tabs.forEach((tab, i) => applyRowState(rows[i], tab));
    pinActiveRow(activeId);
    return;
  }
  if (
    rows.length &&
    rows.length < ids.length &&
    rows.every((row, i) => row.dataset.id === ids[i] && row.dataset.sig === rowSig(tabs[i]))
  ) {
    for (const tab of tabs.slice(rows.length)) listEl.appendChild(rowEl(tab));
    listEl.scrollTop = keepScroll;
    pinActiveRow(activeId);
    return;
  }
  listEl.innerHTML = '';
  if (!allTabs.length && !tabsPending) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No rows yet. Open Ingest to add URLs.';
    listEl.appendChild(empty);
    return;
  }
  if (!tabs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = tabsPending && !allTabs.length ? 'Loading jobs…' : 'No jobs match these filters.';
    listEl.appendChild(empty);
    return;
  }
  for (const tab of tabs) listEl.appendChild(rowEl(tab));
  listEl.scrollTop = keepScroll;
  pinActiveRow(activeId);
}

function pushFilters() {
  window.magnet.setFilters(currentFilters());
}

function renderNotices() {
  if (!noticeBtn || !noticeBadge || !noticeList) return;
  const n = notices.length;
  noticeBtn.hidden = false;
  noticeBadge.hidden = n === 0;
  noticeBadge.textContent = n > 9 ? '9+' : String(n);
  noticeList.replaceChildren();
  if (!n) {
    const empty = document.createElement('div');
    empty.className = 'notice-empty';
    empty.textContent = 'Nothing waiting. Unsure recruiting mail lands here.';
    noticeList.appendChild(empty);
    return;
  }
  for (const row of notices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notice-item';
    const co = document.createElement('span');
    co.className = 'notice-co';
    co.textContent = [row.company, row.title].filter(Boolean).join(' · ') || 'Mail';
    const text = document.createElement('span');
    text.className = 'notice-text';
    text.textContent = row.text || 'Unsure email';
    btn.append(co, text);
    btn.addEventListener('click', () => {
      if (noticePop) noticePop.hidden = true;
      if (window.magnet && window.magnet.openNotice) window.magnet.openNotice(row);
    });
    noticeList.appendChild(btn);
  }
}

let filtersReady = false;

function onTabsPayload(payload) {
  const prevIds = allTabs.map((t) => t.id).join('\n');
  allTabs = payload.tabs || [];
  tabsPending = Number(payload.tabsPending) || 0;
  notices = payload.notices || [];
  controlPort = payload.controlPort;
  totals = payload.totals || totals;
  session = payload.session || session;
  if (prevIds !== allTabs.map((t) => t.id).join('\n')) rebuildFilterOptions();
  if (!filtersReady && payload.filters) {
    rebuildFilterOptions();
    applyFilters(payload.filters);
    filtersReady = true;
  }
  renderList();
  renderNotices();
  maybeMoreTabs();
}

let voiceLoaded = false;
let voiceDirty = false;
let systemPromptUnlocked = false;

function refreshVoicePending() {
  if (!window.magnet || !window.magnet.voicePending) return;
  window.magnet.voicePending().then((out) => {
    const n = (out && out.pending && out.pending.length) || 0;
    if (voicePendingBadge) {
      voicePendingBadge.hidden = n < 1;
      voicePendingBadge.textContent = n ? `${n} rule patch${n === 1 ? '' : 'es'}` : '';
    }
    if (voiceAcceptPending) voiceAcceptPending.hidden = n < 1;
  }).catch(() => {});
}

function loadVoice() {
  if (!voiceText || !window.magnet || !window.magnet.voiceGet) return;
  if (voiceDirty && document.activeElement === voiceText) return;
  window.magnet.voiceGet().then((text) => {
    if (voiceDirty) return;
    voiceText.value = text || '';
    voiceLoaded = true;
    refreshVoicePending();
  }).catch(console.error);
}

async function flushVoice() {
  if (!voiceLoaded || !voiceDirty || !voiceText || !window.magnet || !window.magnet.voiceFlush) return;
  await window.magnet.voiceFlush(voiceText.value);
  voiceDirty = false;
}

function queueVoice() {
  if (!voiceLoaded || !voiceText || !window.magnet || !window.magnet.voiceSet) return;
  voiceDirty = true;
  window.magnet.voiceSet(voiceText.value);
}

function loadSystemPrompt() {
  if (!systemPromptEl || !window.magnet || !window.magnet.systemPromptGet) return;
  if (document.activeElement === systemPromptEl) return;
  window.magnet.systemPromptGet().then((text) => {
    if (document.activeElement === systemPromptEl) return;
    systemPromptEl.value = text || '';
  }).catch(console.error);
}

async function flushSystemPrompt() {
  if (!systemPromptUnlocked || !systemPromptEl || !window.magnet || !window.magnet.systemPromptFlush) return;
  await window.magnet.systemPromptFlush(systemPromptEl.value);
}

function queueSystemPrompt() {
  if (!systemPromptUnlocked || !systemPromptEl || !window.magnet || !window.magnet.systemPromptSet) return;
  window.magnet.systemPromptSet(systemPromptEl.value);
}

function mailStatusText(mail) {
  if (!mail || !mail.connected) return 'Not connected.';
  const bits = [mail.email ? `Signed in as ${mail.email}` : 'Signed in'];
  if (mail.scanned_at) bits.push(`last scan ${String(mail.scanned_at).slice(0, 16)}`);
  if (mail.indexed) bits.push(`${mail.indexed} indexed`);
  if (mail.pending) bits.push(`${mail.pending} need review`);
  return bits.join(' · ');
}

function refreshSettings() {
  if (!window.magnet || !window.magnet.getSettings) return Promise.resolve();
  return window.magnet.getSettings().then(renderSettings);
}

function runSettingsAction(action, button) {
  if (!window.magnet || typeof window.magnet[action.invoke] !== 'function') return;
  const buttons = settingsForm.querySelectorAll('.settings-action');
  buttons.forEach((btn) => {
    btn.disabled = true;
  });
  button.textContent = action.busyLabel || action.label;
  window.magnet[action.invoke]()
    .then((out) => refreshSettings().then(() => out))
    .then((out) => {
      const status = settingsForm.querySelector('.settings-status');
      if (status && out && out.reply) status.textContent = out.reply;
    })
    .catch(console.error)
    .finally(() => {
      buttons.forEach((btn) => {
        btn.disabled = false;
      });
      button.textContent = action.label;
    });
}

function renderSettings(snapshot) {
  if (!settingsForm) return;
  settingsForm.innerHTML = '';
  for (const field of (snapshot && snapshot.fields) || []) {
    if (field.type === 'number') {
      const row = document.createElement('label');
      row.className = 'settings-row';
      const copy = document.createElement('span');
      copy.className = 'settings-copy';
      const title = document.createElement('span');
      title.className = 'settings-label';
      title.textContent = field.label;
      const help = document.createElement('span');
      help.className = 'settings-help';
      help.textContent = field.help || '';
      copy.append(title, help);
      const input = document.createElement('input');
      input.className = 'settings-number';
      input.type = 'number';
      input.min = field.min != null ? String(field.min) : '0';
      input.max = field.max != null ? String(field.max) : '50';
      input.value = String(field.value ?? 0);
      input.setAttribute('aria-label', field.label);
      input.addEventListener('change', () => {
        if (!window.magnet || !window.magnet.setSettings) return;
        window.magnet.setSettings({ [field.key]: Number(input.value) }).then(renderSettings).catch(console.error);
      });
      row.append(copy, input);
      settingsForm.appendChild(row);
      continue;
    }
    if (field.type === 'select') {
      const row = document.createElement('label');
      row.className = 'settings-row';
      const copy = document.createElement('span');
      copy.className = 'settings-copy';
      const title = document.createElement('span');
      title.className = 'settings-label';
      title.textContent = field.label;
      const help = document.createElement('span');
      help.className = 'settings-help';
      help.textContent = field.help || '';
      copy.append(title, help);
      const input = document.createElement('select');
      input.className = 'settings-select';
      input.setAttribute('aria-label', field.label);
      for (const opt of field.options || []) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (String(field.value) === String(opt.value)) option.selected = true;
        input.appendChild(option);
      }
      input.addEventListener('change', () => {
        if (!window.magnet || !window.magnet.setSettings) return;
        window.magnet.setSettings({ [field.key]: input.value }).then(renderSettings).catch(console.error);
      });
      row.append(copy, input);
      settingsForm.appendChild(row);
      continue;
    }
    if (field.type !== 'boolean') continue;
    const row = document.createElement('label');
    row.className = 'settings-row';
    const copy = document.createElement('span');
    copy.className = 'settings-copy';
    const title = document.createElement('span');
    title.className = 'settings-label';
    title.textContent = field.label;
    const help = document.createElement('span');
    help.className = 'settings-help';
    help.textContent = field.help || '';
    copy.append(title, help);
    const toggle = document.createElement('span');
    toggle.className = 'settings-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(field.value);
    input.setAttribute('aria-label', field.label);
    const knob = document.createElement('span');
    toggle.append(input, knob);
    input.addEventListener('change', () => {
      if (!window.magnet || !window.magnet.setSettings) return;
      window.magnet.setSettings({ [field.key]: input.checked }).then(renderSettings).catch(console.error);
    });
    row.append(copy, toggle);
    settingsForm.appendChild(row);
  }

  const groups = new Map();
  for (const action of (snapshot && snapshot.actions) || []) {
    if (!action.available) continue;
    if (!groups.has(action.group)) {
      groups.set(action.group, { label: action.groupLabel || action.group, actions: [] });
    }
    groups.get(action.group).actions.push(action);
  }
  for (const group of groups.values()) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-group';
    const heading = document.createElement('div');
    heading.className = 'settings-group-label';
    heading.textContent = group.label;
    const statusText = group.label === 'Gmail' ? mailStatusText(snapshot.mail) : '';
    const status = document.createElement('div');
    status.className = 'settings-status';
    if (statusText) status.textContent = statusText;
    const list = document.createElement('div');
    list.className = 'settings-actions';
    for (const action of group.actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-action';
      btn.textContent = action.label;
      btn.title = action.help || action.label;
      btn.addEventListener('click', () => runSettingsAction(action, btn));
      list.appendChild(btn);
    }
    wrap.append(heading);
    if (statusText) wrap.append(status);
    wrap.append(list);
    settingsForm.appendChild(wrap);
  }
}

function openSettings() {
  if (!settingsDialog) return;
  const open = (snap) => {
    renderSettings(snap);
    loadVoice();
    loadSystemPrompt();
    if (typeof settingsDialog.showModal === 'function') settingsDialog.showModal();
  };
  if (window.magnet && window.magnet.getSettings) {
    window.magnet.getSettings().then(open).catch(console.error);
    return;
  }
  open({
    mail: { connected: false, email: '', pending: 0 },
    fields: [
      {
        key: 'chatSound',
        type: 'boolean',
        label: 'Sound when Magnet finishes',
        help: 'Play a short chime after chat, essays, or autofill — and when resume or JD fails, or a gotcha shows up.',
        value: true,
      },
      {
        key: 'contextCtrlTab',
        type: 'boolean',
        label: 'Context-dependent Ctrl+Tab',
        help: 'On: cycle JD/Review/Chat when assist is focused and a job is selected, otherwise cycle jobs. Off: Ctrl+Tab always cycles JD/Review/Chat (when a job is selected). Ingest does not cycle page subtabs.',
        value: false,
      },
      {
        key: 'handedness',
        type: 'select',
        label: 'Handedness',
        help: 'Right-handed (default): overflow left, Ingest right of the current job. Left-handed flips the rails, Send/model, and the target clear button.',
        options: [
          { value: 'right', label: 'Right-handed' },
          { value: 'left', label: 'Left-handed' },
        ],
        value: 'right',
      },
      {
        key: 'uiLanguage',
        type: 'select',
        label: 'Page language',
        help: 'Force job-board and LinkedIn pages to this language, ignoring region.',
        options: [
          { value: 'en-US', label: 'English' },
          { value: 'es', label: 'Spanish' },
          { value: 'fr', label: 'French' },
          { value: 'de', label: 'German' },
          { value: 'pt-BR', label: 'Portuguese' },
          { value: 'ja', label: 'Japanese' },
          { value: 'zh-CN', label: 'Chinese' },
        ],
        value: 'en-US',
      },
    ],
    actions: [
      {
        key: 'gmailConnect',
        group: 'gmail',
        groupLabel: 'Gmail',
        label: 'Sign in',
        help: 'Connect Gmail so Magnet can scan application replies.',
        invoke: 'connectMail',
        available: true,
      },
      {
        key: 'gmailScan',
        group: 'gmail',
        groupLabel: 'Gmail',
        label: 'Scan inbox',
        help: 'Archive rejections and application receipts. Notify you about anything else.',
        invoke: 'scanMail',
        busyLabel: 'Scanning…',
        available: true,
      },
    ],
  });
}

function fallbackLogo(name) {
  const el = document.createElement('div');
  el.className = 'logo fallback';
  el.textContent = initials(name);
  return el;
}

if (window.magnet) {
  backBtn.addEventListener('click', () => window.magnet.back());
  forwardBtn.addEventListener('click', () => window.magnet.forward());
  reloadBtn.addEventListener('click', () => window.magnet.reload());
  homeBtn.addEventListener('click', () => window.magnet.home());
  document.getElementById('nav-copy').addEventListener('click', () => window.magnet.copyUrl());
  document.getElementById('nav-zoom-in').addEventListener('click', () => window.magnet.zoomIn());
  document.getElementById('nav-zoom-out').addEventListener('click', () => window.magnet.zoomOut());
  document.getElementById('url-form').addEventListener('submit', (e) => {
    e.preventDefault();
    window.magnet.go(navUrl.value);
    navUrl.blur();
  });
  document.getElementById('open-ingest').addEventListener('click', () => window.magnet.openIngest());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (noticePop && !noticePop.hidden) {
      noticePop.hidden = true;
    }
  });
  searchEl.addEventListener('input', () => {
    pushFilters();
    moreAsked = false;
    renderList();
    maybeMoreTabs();
  });
  filterStatus.addEventListener('change', () => {
    pushFilters();
    moreAsked = false;
    renderList();
    maybeMoreTabs();
  });
  filterYoe.addEventListener('change', () => {
    pushFilters();
    moreAsked = false;
    renderList();
    maybeMoreTabs();
  });
  filterLevel.addEventListener('change', () => {
    pushFilters();
    moreAsked = false;
    renderList();
    maybeMoreTabs();
  });
  if (filterSort) {
    filterSort.addEventListener('change', () => {
      pushFilters();
      moreAsked = false;
      renderList();
      maybeMoreTabs();
    });
  }
  listEl.addEventListener('scroll', () => {
    moreAsked = false;
    maybeMoreTabs();
  });
  window.magnet.onTabsUpdate(onTabsPayload);
  window.magnet.onNavState(renderNav);
  window.magnet.onFocusUrl(() => {
    navUrl.focus();
    navUrl.select();
    try {
      navUrl.setSelectionRange(0, navUrl.value.length);
    } catch (_) {}
  });
  window.magnet.list().then(onTabsPayload).catch(console.error);
} else {
  apiHint.textContent = 'preload missing';
}

if (insightsBtn && window.magnet && window.magnet.openInsights) {
  insightsBtn.addEventListener('click', () => {
    window.magnet.openInsights().catch(console.error);
  });
}
const libraryBtn = document.getElementById('library-btn');
if (libraryBtn && window.magnet && window.magnet.openLibrary) {
  libraryBtn.addEventListener('click', () => {
    window.magnet.openLibrary().catch(console.error);
  });
}
if (essayLogBtn && window.magnet && window.magnet.openEssayLog) {
  essayLogBtn.addEventListener('click', () => {
    window.magnet.openEssayLog().catch(console.error);
  });
}
if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
if (noticeBtn && noticePop) {
  noticeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    noticePop.hidden = !noticePop.hidden;
  });
  document.addEventListener('click', () => {
    if (noticePop) noticePop.hidden = true;
  });
  noticePop.addEventListener('click', (e) => e.stopPropagation());
}
if (settingsClose && settingsDialog) {
  settingsClose.addEventListener('click', () => {
    flushVoice().catch(console.error);
    flushSystemPrompt().catch(console.error);
    settingsDialog.close();
  });
}
if (voiceText) {
  voiceText.addEventListener('input', queueVoice);
  voiceText.addEventListener('blur', () => {
    flushVoice().catch(console.error);
  });
}
if (voiceSaveBtn && window.magnet && window.magnet.voiceSave) {
  voiceSaveBtn.addEventListener('click', async () => {
    const out = await window.magnet.voiceSave(voiceText.value);
    voiceDirty = false;
    if (out && out.text != null) voiceText.value = out.text;
    refreshVoicePending();
  });
}
if (voiceAcceptPending && window.magnet && window.magnet.voiceAcceptPending) {
  voiceAcceptPending.addEventListener('click', async () => {
    const out = await window.magnet.voiceAcceptPending();
    if (out && out.text != null) voiceText.value = out.text;
    voiceDirty = false;
    refreshVoicePending();
  });
}
if (voiceHistoryBtn && voiceHistoryModal && window.magnet && window.magnet.voiceHistory) {
  voiceHistoryBtn.addEventListener('click', async () => {
    const out = await window.magnet.voiceHistory();
    const versions = (out && out.versions) || [];
    if (voiceHistoryList) {
      voiceHistoryList.innerHTML = '';
      for (const v of versions) {
        const li = document.createElement('li');
        li.className = `voice-hist voice-hist-${v.kind || 'user'}`;
        const meta = document.createElement('div');
        meta.className = 'voice-hist-meta';
        meta.textContent = `${v.kind || 'user'} · ${v.created_at || ''} · #${v.id}`;
        const pre = document.createElement('pre');
        pre.textContent = v.preview || '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'settings-action';
        btn.textContent = 'Restore';
        btn.addEventListener('click', async () => {
          const row = await window.magnet.voiceRevert(v.id);
          if (row && row.text != null) voiceText.value = row.text;
          voiceDirty = false;
          voiceHistoryModal.close();
          refreshVoicePending();
        });
        li.append(meta, pre, btn);
        voiceHistoryList.appendChild(li);
      }
    }
    if (typeof voiceHistoryModal.showModal === 'function') voiceHistoryModal.showModal();
  });
}
if (voiceHistoryClose && voiceHistoryModal) {
  voiceHistoryClose.addEventListener('click', () => voiceHistoryModal.close());
}
if (systemPromptEl) {
  systemPromptEl.addEventListener('input', queueSystemPrompt);
  systemPromptEl.addEventListener('blur', () => {
    flushSystemPrompt().catch(console.error);
  });
}
if (systemPromptEdit && systemPromptEl) {
  systemPromptEdit.addEventListener('click', () => {
    systemPromptUnlocked = true;
    systemPromptEl.disabled = false;
    systemPromptEl.focus();
  });
}
if (settingsDialog) {
  settingsDialog.addEventListener('click', (e) => {
    if (e.target === settingsDialog) settingsDialog.close();
  });
}
