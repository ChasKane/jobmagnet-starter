const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magnetEssayLog', {
  list: (opts) => ipcRenderer.invoke('magnet:essay-log', opts || {}),
});
