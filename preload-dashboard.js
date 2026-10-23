const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magnetDash', {
  get: () => ipcRenderer.invoke('magnet:process-get'),
  rejected: (note) => ipcRenderer.invoke('magnet:process-rejected', note),
  event: (event) => ipcRenderer.invoke('magnet:process-event', event),
  saveNotes: (prep_notes) => ipcRenderer.invoke('magnet:process-notes', prep_notes),
  addContact: (contact) => ipcRenderer.invoke('magnet:process-contact', contact),
  overflow: (action) => ipcRenderer.invoke('magnet:process-overflow', action),
  scanMail: () => ipcRenderer.invoke('magnet:mail-scan'),
  resolveMail: (id, action) => ipcRenderer.invoke('magnet:mail-resolve', { id, action }),
  connectMail: () => ipcRenderer.invoke('magnet:mail-connect'),
  signOutMail: () => ipcRenderer.invoke('magnet:mail-signout'),
  openPosting: () => ipcRenderer.send('magnet:open-posting'),
  showDashboard: () => ipcRenderer.send('magnet:show-dashboard'),
  openExternal: () => ipcRenderer.send('magnet:open-external'),
  onUpdate: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('magnet:process', h);
    return () => ipcRenderer.removeListener('magnet:process', h);
  },
});
