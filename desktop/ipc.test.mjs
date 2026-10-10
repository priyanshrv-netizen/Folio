import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { BRIDGE_METHODS, registerBridge } from './ipc.mjs';
import { rendererRequestAllowed } from './requests.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

describe('renderer resource boundaries', () => {
  const dist = resolve('dist');
  it('allows only built assets in production, never arbitrary local files or remote requests', () => {
    expect(
      rendererRequestAllowed(pathToFileURL(resolve('dist/index.html')).href, dist, false),
    ).toBe(true);
    expect(
      rendererRequestAllowed(pathToFileURL(resolve('dist/assets/app.js')).href, dist, false),
    ).toBe(true);
    expect(rendererRequestAllowed(pathToFileURL(resolve('settings.json')).href, dist, false)).toBe(
      false,
    );
    expect(
      rendererRequestAllowed(pathToFileURL(resolve('dist-other/index.html')).href, dist, false),
    ).toBe(false);
    expect(rendererRequestAllowed('https://example.test/tracker', dist, false)).toBe(false);
    expect(rendererRequestAllowed('data:image/png;base64,AAAA', dist, false)).toBe(true);
    expect(rendererRequestAllowed('blob:file:///image', dist, false)).toBe(true);
  });
  it('allows only the explicit Vite HTTP and websocket origins in development', () => {
    expect(rendererRequestAllowed('http://127.0.0.1:5173/src/main.tsx', dist, true)).toBe(true);
    expect(rendererRequestAllowed('ws://127.0.0.1:5173/', dist, true)).toBe(true);
    expect(rendererRequestAllowed('http://127.0.0.1:5555/private', dist, true)).toBe(false);
    expect(rendererRequestAllowed('http://example.test:5173/', dist, true)).toBe(false);
    expect(rendererRequestAllowed(pathToFileURL(resolve('settings.json')).href, dist, true)).toBe(
      false,
    );
  });
});

describe('Folio sandbox bridge', () => {
  const entryUrl = 'file:///app/dist/index.html';
  function setup() {
    const handlers = new Map();
    const frame = { url: entryUrl };
    const webContents = { mainFrame: frame };
    const window = { isDestroyed: () => false, webContents };
    const bridge = Object.fromEntries(
      BRIDGE_METHODS.map((method) => [method, vi.fn(async () => 'ok')]),
    );
    registerBridge(
      { handle: (name, fn) => handlers.set(name, fn) },
      () => window,
      entryUrl,
      bridge,
    );
    return { handlers, window, bridge, event: { sender: webContents, senderFrame: frame } };
  }

  it('exposes exactly the nine typed methods, without raw IPC or paths', async () => {
    const exposed = {};
    const invoke = vi.fn(async () => 'ok');
    const contextBridge = {
      exposeInMainWorld: (name, value) => {
        exposed[name] = value;
      },
    };
    const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8');
    runInNewContext(preload, {
      require: (name) => {
        expect(name).toBe('electron');
        return { contextBridge, ipcRenderer: { invoke } };
      },
    });
    expect(Object.keys(exposed)).toEqual(['folio']);
    expect(Object.keys(exposed.folio)).toEqual(BRIDGE_METHODS);
    expect(Object.isFrozen(exposed.folio)).toBe(true);
    for (const method of BRIDGE_METHODS) await exposed.folio[method]('test');
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(
      BRIDGE_METHODS.map((method) => `folio:${method}`),
    );
  });

  it('accepts only the exact entry URL in the trusted main frame', async () => {
    const { handlers, event, bridge } = setup();
    expect(await handlers.get('folio:loadDocument')(event, 'document-1')).toBe('ok');
    expect(bridge.loadDocument).toHaveBeenCalledWith('document-1');
  });

  it.each(['sender', 'subframe', 'missing', 'navigated', 'destroyed'])(
    'rejects %s IPC senders',
    async (kind) => {
      const { handlers, event, bridge, window } = setup();
      if (kind === 'sender') event.sender = {};
      if (kind === 'subframe') event.senderFrame = { url: entryUrl };
      if (kind === 'missing') event.senderFrame = undefined;
      if (kind === 'navigated') event.senderFrame.url = 'https://evil.test';
      if (kind === 'destroyed') window.isDestroyed = () => true;
      await expect(handlers.get('folio:getSettings')(event)).rejects.toThrow(/Untrusted/);
      expect(bridge.getSettings).not.toHaveBeenCalled();
    },
  );

  it('checks request arity and sanitizes implementation errors', async () => {
    const { handlers, event, bridge } = setup();
    await expect(handlers.get('folio:getSettings')(event, 'unexpected')).rejects.toThrow(
      /Invalid Folio/,
    );
    await expect(handlers.get('folio:saveDocument')(event)).rejects.toThrow(/Invalid Folio/);
    bridge.saveSettings.mockRejectedValueOnce(new Error('SECRET and C:\\private\\path'));
    await expect(handlers.get('folio:saveSettings')(event, {})).rejects.toThrow(
      'Settings could not be saved. Check the fields and operating-system secure credential storage.',
    );
  });
});
