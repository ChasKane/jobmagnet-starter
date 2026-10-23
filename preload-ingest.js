const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magnetIngest', {
  submit: (message) => ipcRenderer.invoke('magnet:ingest', message),
});
