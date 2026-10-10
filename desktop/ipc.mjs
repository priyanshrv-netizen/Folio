export const BRIDGE_METHODS = Object.freeze([
  'listDocuments',
  'loadDocument',
  'saveDocument',
  'getSettings',
  'saveSettings',
  'syncDocument',
  'listCloudDocuments',
  'loadCloudDocument',
  'generateImage',
]);

const ERRORS = {
  listDocuments: 'Local documents could not be listed.',
  loadDocument: 'Document could not be loaded. It may be missing or invalid.',
  saveDocument: 'Document could not be saved. Check its format and available disk space.',
  getSettings: 'Settings could not be read or credentials could not be securely unlocked.',
  saveSettings:
    'Settings could not be saved. Check the fields and operating-system secure credential storage.',
  syncDocument: 'Cloud backup failed. Check the document and cloud settings.',
  listCloudDocuments:
    'Cloud documents could not be listed. Check the cloud settings and connection.',
  loadCloudDocument: 'Cloud document could not be loaded. Check its format and cloud settings.',
  generateImage:
    'Image generation failed. Check the prompt, provider settings, credentials, and connection.',
};

export function registerBridge(ipcMain, getWindow, entryUrl, bridge) {
  for (const method of BRIDGE_METHODS) {
    ipcMain.handle(`folio:${method}`, async (event, ...args) => {
      const window = getWindow();
      if (
        !window ||
        window.isDestroyed() ||
        event.sender !== window.webContents ||
        !event.senderFrame ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== entryUrl
      )
        throw new Error('Untrusted Folio IPC sender.');
      const arity = ['listDocuments', 'getSettings', 'listCloudDocuments'].includes(method) ? 0 : 1;
      if (args.length !== arity) throw new Error('Invalid Folio request.');
      try {
        return await bridge[method](...args);
      } catch {
        throw new Error(ERRORS[method]);
      }
    });
  }
}
