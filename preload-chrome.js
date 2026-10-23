const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magnetChrome', {
  onUpdate: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('magnet:chrome', handler);
    return () => ipcRenderer.removeListener('magnet:chrome', handler);
  },
  getActive: () => ipcRenderer.invoke('magnet:chrome-active'),
  complete: (id) => ipcRenderer.invoke('magnet:complete', id),
  pass: (id) => ipcRenderer.invoke('magnet:pass', id),
  undoOutcome: () => ipcRenderer.invoke('magnet:undo-outcome'),
  autofill: (id) => ipcRenderer.invoke('magnet:autofill', id),
  runAll: (id) => ipcRenderer.invoke('magnet:all', id),
  cancel: (id) => ipcRenderer.invoke('magnet:cancel', id),
  jd: (id) => ipcRenderer.invoke('magnet:jd', id),
  fill: (id) => ipcRenderer.invoke('magnet:fill', id),
  essays: (id) => ipcRenderer.invoke('magnet:essays', id),
  essayFill: (id, fieldIds, instruction) =>
    ipcRenderer.invoke('magnet:essay-fill', { id, fieldIds, instruction }),
  chatSend: (id, text, fieldIds) => ipcRenderer.invoke('magnet:chat-send', { id, text, fieldIds }),
  selectChat: (key) => ipcRenderer.send('magnet:chat-select', key),
  openChatJob: (id) => ipcRenderer.send('magnet:chat-open-job', id),
  ingestSend: (message) => ipcRenderer.invoke('magnet:ingest-send', message),
  ingestApprove: (schema) => ipcRenderer.invoke('magnet:ingest-approve', schema),
  chatCancel: (id) => ipcRenderer.invoke('magnet:chat-cancel', id),
  chatTargetClear: (id) => ipcRenderer.invoke('magnet:chat-target-clear', id),
  chatExpand: (id) => ipcRenderer.invoke('magnet:chat-expand', id),
  chatDraftCancel: (id) => ipcRenderer.invoke('magnet:chat-draft-cancel', id),
  onChatDelta: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('magnet:chat-delta', h);
    return () => ipcRenderer.removeListener('magnet:chat-delta', h);
  },
  getModels: () => ipcRenderer.invoke('magnet:models-get'),
  setModel: (patch) => ipcRenderer.invoke('magnet:models-set', patch),
  chatAnswer: (id, asks, answers) => ipcRenderer.invoke('magnet:chat-answer', { id, asks, answers }),
  setChromeChips: (open) => ipcRenderer.send('magnet:chrome-chips', Boolean(open)),
  voiceGet: () => ipcRenderer.invoke('magnet:voice-get'),
  voiceSet: (text) => ipcRenderer.invoke('magnet:voice-set', text),
  voiceFlush: (text) => ipcRenderer.invoke('magnet:voice-flush', text),
  voiceSave: (text) => ipcRenderer.invoke('magnet:voice-save', text),
  voiceHistory: () => ipcRenderer.invoke('magnet:voice-history'),
  voiceRevert: (id) => ipcRenderer.invoke('magnet:voice-revert', id),
  voiceAcceptPending: () => ipcRenderer.invoke('magnet:voice-accept-pending'),
  voicePending: () => ipcRenderer.invoke('magnet:voice-pending'),
  systemPromptGet: () => ipcRenderer.invoke('magnet:system-prompt-get'),
  systemPromptSet: (text) => ipcRenderer.invoke('magnet:system-prompt-set', text),
  systemPromptFlush: (text) => ipcRenderer.invoke('magnet:system-prompt-flush', text),
  uploadResume: (id) => ipcRenderer.invoke('magnet:upload-resume', id),
  pickResume: (id, resumeId) => ipcRenderer.invoke('magnet:pick-resume', { id, resumeId }),
  debugFocus: (id, fieldId) => ipcRenderer.invoke('magnet:debug-focus', { id, fieldId }),
  debugFlag: (id, fieldId, flag, correction) =>
    ipcRenderer.invoke('magnet:debug-flag', { id, fieldId, flag, correction }),
  reviewRetry: (id, fieldId, opts = {}) =>
    ipcRenderer.invoke('magnet:review-retry', {
      id,
      fieldId,
      strategy: opts.strategy || '',
      value: opts.value,
      flag: opts.flag || '',
      label: opts.label || '',
    }),
  reviewAccept: (id, fieldId, value, steps, label, opts = {}) =>
    ipcRenderer.invoke('magnet:review-accept', {
      id,
      fieldId,
      value,
      steps,
      label,
      skip: Boolean(opts && opts.skip),
      classId: (opts && (opts.classId || opts.class)) || '',
    }),
  reviewLearnSteps: (id, fieldId, steps, value) =>
    ipcRenderer.invoke('magnet:review-learn-steps', { id, fieldId, steps, value }),
  reviewRecordStart: (id, fieldId) => ipcRenderer.invoke('magnet:review-record-start', { id, fieldId }),
  reviewRecordStop: (id, fieldId) => ipcRenderer.invoke('magnet:review-record-stop', { id, fieldId }),
  reviewRecordConfirm: (id, fieldId) => ipcRenderer.invoke('magnet:review-record-confirm', { id, fieldId }),
  reviewLearnRecipe: (id, recipeId, accept, value) =>
    ipcRenderer.invoke('magnet:review-learn-recipe', { id, recipeId, accept, value }),
  reviewRun: (id, fieldId, source, opts = {}) =>
    ipcRenderer.invoke('magnet:review-run', {
      id,
      fieldId,
      source,
      save: Boolean(opts.save),
      saveWithoutVerify: Boolean(opts.saveWithoutVerify),
    }),
  reviewRewrite: (id, fieldId, instruction) =>
    ipcRenderer.invoke('magnet:review-rewrite', { id, fieldId, instruction }),
  reviewAnswer: (id, askId, answer) =>
    ipcRenderer.invoke('magnet:review-answer', { id, askId, answer }),
  reviewChat: (id, fieldId, text) =>
    ipcRenderer.invoke('magnet:review-chat', { id, fieldId, text }),
  reviewCancel: (id, opts = {}) =>
    ipcRenderer.invoke('magnet:review-cancel', { id, stop: Boolean(opts.stop) }),
  setDrawer: (which) => ipcRenderer.send('magnet:drawer', which),
  setShellPane: (pane) => ipcRenderer.send('magnet:shell-pane', pane),
  getShellPane: () => ipcRenderer.invoke('magnet:shell-pane'),
  onShellPane: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('magnet:shell-pane', h);
    return () => ipcRenderer.removeListener('magnet:shell-pane', h);
  },
  openPosting: () => ipcRenderer.send('magnet:open-posting'),
  showDashboard: () => ipcRenderer.send('magnet:show-dashboard'),
  openMail: (href) => ipcRenderer.send('magnet:open-mail', href),
  resolveMail: (id, action) => ipcRenderer.invoke('magnet:mail-resolve', { id, action }),
  openExternal: () => ipcRenderer.send('magnet:open-external'),
  openJdPage: () => ipcRenderer.send('magnet:open-jd-page'),
  onDrawerMode: (cb) => {
    const h = (_e, mode) => cb(mode);
    ipcRenderer.on('magnet:drawer-mode', h);
    return () => ipcRenderer.removeListener('magnet:drawer-mode', h);
  },
  onIngestFocus: (cb) => {
    const h = () => cb();
    ipcRenderer.on('magnet:ingest-focus', h);
    return () => ipcRenderer.removeListener('magnet:ingest-focus', h);
  },
  clipboardJd: (id) => ipcRenderer.invoke('magnet:jd-clipboard', id),
  clipboardWrite: (text) => ipcRenderer.invoke('magnet:clipboard-write', text),
  onFindOpen: (cb) => {
    const h = () => cb();
    ipcRenderer.on('magnet:find-open', h);
    return () => ipcRenderer.removeListener('magnet:find-open', h);
  },
  onFindFocus: (cb) => {
    const h = () => cb();
    ipcRenderer.on('magnet:find-focus', h);
    return () => ipcRenderer.removeListener('magnet:find-focus', h);
  },
  onFindClose: (cb) => {
    const h = () => cb();
    ipcRenderer.on('magnet:find-close', h);
    return () => ipcRenderer.removeListener('magnet:find-close', h);
  },
  onFindResult: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('magnet:find-result', h);
    return () => ipcRenderer.removeListener('magnet:find-result', h);
  },
  findQuery: (text, opts = {}) =>
    ipcRenderer.send('magnet:find-query', {
      text,
      forward: opts.forward !== false,
      findNext: Boolean(opts.findNext),
    }),
  findClose: () => ipcRenderer.send('magnet:find-close'),
  onToast: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('magnet:toast', h);
    return () => ipcRenderer.removeListener('magnet:toast', h);
  },
  onAttentionSound: (cb) => {
    const h = () => cb();
    ipcRenderer.on('magnet:attention-sound', h);
    return () => ipcRenderer.removeListener('magnet:attention-sound', h);
  },
  huntLogin: (action) => ipcRenderer.invoke('magnet:hunt-login', action),
  ingestAnswer: (asks, answers) => ipcRenderer.invoke('magnet:ingest-answer', { asks, answers }),
  onFlagging: (cb) => {
    const h = (_e, on) => cb(on);
    ipcRenderer.on('magnet:flagging', h);
    return () => ipcRenderer.removeListener('magnet:flagging', h);
  },
});
