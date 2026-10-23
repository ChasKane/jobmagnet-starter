const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magnet', {
  onTabsUpdate: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('magnet:tabs', handler);
    return () => ipcRenderer.removeListener('magnet:tabs', handler);
  },
  onNavState: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('magnet:nav', handler);
    return () => ipcRenderer.removeListener('magnet:nav', handler);
  },
  onFocusUrl: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('magnet:url-focus', handler);
    return () => ipcRenderer.removeListener('magnet:url-focus', handler);
  },
  activate: (id) => ipcRenderer.send('magnet:activate', id),
  moreTabs: () => ipcRenderer.send('magnet:tabs-more'),
  setFilters: (filters) => ipcRenderer.send('magnet:filters', filters),
  autofill: (id) => ipcRenderer.invoke('magnet:autofill', id),
  list: () => ipcRenderer.invoke('magnet:list'),
  navState: () => ipcRenderer.invoke('magnet:nav-state'),
  back: () => ipcRenderer.send('magnet:back'),
  forward: () => ipcRenderer.send('magnet:forward'),
  reload: () => ipcRenderer.send('magnet:reload'),
  home: () => ipcRenderer.send('magnet:home'),
  go: (url) => ipcRenderer.send('magnet:go', url),
  openIngest: () => ipcRenderer.send('magnet:ingest-open'),
  ingestSend: (message) => ipcRenderer.invoke('magnet:ingest-send', message),
  ingestApprove: (schema) => ipcRenderer.invoke('magnet:ingest-approve', schema),
  ingestAnswer: (asks, answers) => ipcRenderer.invoke('magnet:ingest-answer', { asks, answers }),
  ingestClose: () => ipcRenderer.send('magnet:ingest-close'),
  copyUrl: () => ipcRenderer.send('magnet:copy-url'),
  zoomIn: () => ipcRenderer.send('magnet:zoom-in'),
  zoomOut: () => ipcRenderer.send('magnet:zoom-out'),
  getSettings: () => ipcRenderer.invoke('magnet:settings-get'),
  setSettings: (patch) => ipcRenderer.invoke('magnet:settings-set', patch),
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
  connectMail: () => ipcRenderer.invoke('magnet:mail-connect'),
  signOutMail: () => ipcRenderer.invoke('magnet:mail-signout'),
  scanMail: () => ipcRenderer.invoke('magnet:mail-scan'),
  openNotice: (notice) => ipcRenderer.invoke('magnet:notice-open', notice),
  importResume: () => ipcRenderer.invoke('magnet:import-resume'),
  exportBundle: () => ipcRenderer.invoke('magnet:export-bundle'),
  importBundle: () => ipcRenderer.invoke('magnet:import-bundle'),
  command: (name, payload) => ipcRenderer.invoke('magnet:command', { name, payload }),
  openEssayLog: () => ipcRenderer.invoke('magnet:essay-log-open'),
  openInsights: () => ipcRenderer.invoke('magnet:insights-open'),
  openLibrary: () => ipcRenderer.invoke('magnet:library-open'),
});
