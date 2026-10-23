const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magnetInsights', {
  get: () => ipcRenderer.invoke('magnet:insights-get'),
  save: (config) => ipcRenderer.invoke('magnet:insights-save', config),
  openPage: (page) => ipcRenderer.invoke('magnet:data-page', page),
  libraryCatalog: () => ipcRenderer.invoke('magnet:library-catalog'),
  libraryQuery: (query) => ipcRenderer.invoke('magnet:library-query', query),
  libraryRead: (query) => ipcRenderer.invoke('magnet:library-read', query),
  libraryWrite: (payload) => ipcRenderer.invoke('magnet:library-write', payload),
  onRefresh: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('magnet:insights-refresh', handler);
    return () => ipcRenderer.removeListener('magnet:insights-refresh', handler);
  },
});
