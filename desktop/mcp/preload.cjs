const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'folioMcp',
  Object.freeze({
    status: () => ipcRenderer.invoke('folioMcp:status'),
    enable: (options = {}) => ipcRenderer.invoke('folioMcp:enable', options),
    disable: () => ipcRenderer.invoke('folioMcp:disable'),
    setContext: (context) => ipcRenderer.invoke('folioMcp:setContext', context),
    reply: (reply) => ipcRenderer.invoke('folioMcp:reply', reply),
    onCommand: (callback) => {
      const listener = (_event, request) => callback(request);
      ipcRenderer.on('folioMcp:command', listener);
      return () => ipcRenderer.removeListener('folioMcp:command', listener);
    },
    onCancel: (callback) => {
      const listener = (_event, id) => callback(id);
      ipcRenderer.on('folioMcp:cancel', listener);
      return () => ipcRenderer.removeListener('folioMcp:cancel', listener);
    },
  }),
);
