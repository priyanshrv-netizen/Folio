const { contextBridge, ipcRenderer } = require('electron');



contextBridge.exposeInMainWorld(
  'folio',
  Object.freeze({
    listDocuments: () => ipcRenderer.invoke('folio:listDocuments'),
    loadDocument: (id) => ipcRenderer.invoke('folio:loadDocument', id),
    saveDocument: (document) => ipcRenderer.invoke('folio:saveDocument', document),
    getSettings: () => ipcRenderer.invoke('folio:getSettings'),
    saveSettings: (settings) => ipcRenderer.invoke('folio:saveSettings', settings),
    syncDocument: (document) => ipcRenderer.invoke('folio:syncDocument', document),
    listCloudDocuments: () => ipcRenderer.invoke('folio:listCloudDocuments'),
    loadCloudDocument: (id) => ipcRenderer.invoke('folio:loadCloudDocument', id),
    generateImage: (prompt) => ipcRenderer.invoke('folio:generateImage', prompt),
  }),
);
