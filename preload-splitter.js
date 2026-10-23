const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magnetSplit', {
  start: (screenX) => ipcRenderer.sendSync('magnet:split-start', { screenX }),
  move: (screenX) => ipcRenderer.send('magnet:split-move', { screenX }),
  end: () => ipcRenderer.send('magnet:split-end'),
});
