import { app, BrowserWindow, ipcMain, safeStorage, nativeImage, session, dialog } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createDocumentStore } from './persistence/documents.mjs';
import { createSettingsStore } from './persistence/settings.mjs';
import { createCloudProvider } from './providers/s3.mjs';
import { createImageProvider } from './providers/images.mjs';
import { registerBridge } from './ipc.mjs';
import { rendererRequestAllowed } from './requests.mjs';
import { registerMcpBridge } from './mcp/bridge.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');
const entryFile = join(directory, '..', 'dist', 'index.html');
const entryUrl = dev ? 'http://127.0.0.1:5173/' : pathToFileURL(entryFile).href;
let window;
let allowQuit = false;
let mcp;

app.setName('Folio');
app.enableSandbox();
if (process.env.FOLIO_DATA_DIR) {
  if (!isAbsolute(process.env.FOLIO_DATA_DIR))
    throw new Error('FOLIO_DATA_DIR must be an absolute directory.');
  mkdirSync(process.env.FOLIO_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.FOLIO_DATA_DIR);
}

async function createWindow() {
  window = new BrowserWindow({
    title: 'Folio',
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f5f5f7',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#282828', symbolColor: '#cccccc', height: 39 },
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(directory, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-prevent-unload', () => {
    allowQuit = false;
  });
  window.webContents.on('render-process-gone', () => mcp?.rendererGone());
  window.webContents.on('did-start-loading', () => mcp?.rendererGone());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    mcp?.rendererGone();
    window = undefined;
  });
  if (dev) await window.loadURL(entryUrl);
  else await window.loadFile(entryFile);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const userData = app.getPath('userData');
      const documents = createDocumentStore(userData);
      const settings = createSettingsStore(userData, safeStorage);
      const cloud = createCloudProvider(settings);
      const images = createImageProvider(settings, {
        verifyImage(bytes) {
          const image = nativeImage.createFromBuffer(bytes);
          const { width, height } = image.getSize();
          if (
            image.isEmpty() ||
            !width ||
            !height ||
            width > 16384 ||
            height > 16384 ||
            width * height > 64_000_000
          ) {
            throw new Error('Invalid or oversized raster image dimensions.');
          }
        },
      });
      registerBridge(ipcMain, () => window, entryUrl, {
        listDocuments: documents.listDocuments,
        loadDocument: documents.loadDocument,
        saveDocument: documents.saveDocument,
        getSettings: settings.getSettings,
        saveSettings: settings.saveSettings,
        ...cloud,
        ...images,
      });
      mcp = registerMcpBridge(ipcMain, () => window, entryUrl);
      session.defaultSession.registerPreloadScript({
        type: 'frame',
        filePath: join(directory, 'mcp', 'preload.cjs'),
      });
      let draining = false;
      app.on('before-quit', (event) => {
        if (allowQuit) return;
        event.preventDefault();
        if (draining) return;
        draining = true;
        Promise.allSettled([documents.flush(), settings.flush(), mcp.close()]).then(() => {
          draining = false;
          allowQuit = true;
          app.quit();
        });
      });
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        callback({
          cancel: !rendererRequestAllowed(details.url, join(directory, '..', 'dist'), dev),
        });
      });
      session.defaultSession.on('will-download', (event, item) => {
        if (!/^(?:blob:|data:)/.test(item.getURL())) event.preventDefault();
      });
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const policy = `default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${dev ? "'self' ws://127.0.0.1:5173" : "'none'"}; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'`;
        const headers = Object.fromEntries(
          Object.entries(details.responseHeaders ?? {}).filter(
            ([name]) => name.toLowerCase() !== 'content-security-policy',
          ),
        );
        callback({ responseHeaders: { ...headers, 'Content-Security-Policy': [policy] } });
      });
      await createWindow();
      app.on('activate', () => {
        if (!BrowserWindow.getAllWindows().length) createWindow().catch(() => app.quit());
      });
    })
    .catch(() => {
      dialog.showErrorBox(
        'Folio could not start',
        'The desktop application could not be initialized. Build the renderer and check access to the application data directory.',
      );
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
