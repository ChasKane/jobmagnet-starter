const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('magnetMirror', {
  send: (id, value) => ipcRenderer.send('magnet:mirror', { id, value }),
  save: (id, value) => ipcRenderer.invoke('magnet:mirror', { id, value }),
});
contextBridge.exposeInMainWorld('magnetAts', {
  debugFlag: (fieldId, flag, correction) =>
    ipcRenderer.invoke('magnet:debug-flag-active', { fieldId, flag, correction }),
  harvest: (payload) => ipcRenderer.send('magnet:harvest', payload),
  fieldFocus: (payload) => ipcRenderer.send('magnet:field-focus', payload),
});
