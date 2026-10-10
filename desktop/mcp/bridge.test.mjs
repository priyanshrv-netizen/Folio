import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { registerMcpBridge } from './bridge.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});
const scope = { documentId: 'doc-1', pageId: 'page-1', epoch: 'epoch-1' };
function setup(options = {}) {
  const handlers = new Map();
  const entryUrl = 'file:///app/dist/index.html';
  const frame = { url: entryUrl };
  const sent = [];
  const contents = {
    mainFrame: frame,
    send: (channel, payload) => sent.push({ channel, payload }),
  };
  const window = { isDestroyed: () => false, webContents: contents };
  const event = { sender: contents, senderFrame: frame };
  const bridge = registerMcpBridge(
    { handle: (name, handler) => handlers.set(name, handler) },
    () => window,
    entryUrl,
    options,
  );
  cleanups.push(() => bridge.close());
  const invoke = (method, ...args) => handlers.get(`folioMcp:${method}`)(event, ...args);
  return { handlers, window, event, sent, invoke, bridge };
}
async function clientFor(test) {
  await test.invoke('setContext', scope);
  let endpoint;
  for (let port = 32100; port < 32200; port++) {
    try {
      endpoint = (await test.invoke('enable', { port })).endpoint;
      break;
    } catch {}
  }
  expect(endpoint).toBeTruthy();
  const client = new Client({ name: 'bridge-test', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  cleanups.push(() => client.close());
  return client;
}

describe('trusted renderer MCP bridge', () => {
  it.each(['sender', 'subframe', 'missing', 'navigated', 'destroyed'])(
    'rejects %s senders exactly as the existing Folio bridge',
    async (kind) => {
      const test = setup();
      if (kind === 'sender') test.event.sender = {};
      if (kind === 'subframe') test.event.senderFrame = { url: test.event.senderFrame.url };
      if (kind === 'missing') test.event.senderFrame = undefined;
      if (kind === 'navigated') test.event.senderFrame.url = 'https://evil.test';
      if (kind === 'destroyed') test.window.isDestroyed = () => true;
      for (const method of ['status', 'enable', 'disable', 'setContext', 'reply'])
        await expect(test.invoke(method)).rejects.toThrow('Untrusted');
    },
  );
  it('checks context, port, and method arity without exposing arbitrary IPC', async () => {
    const test = setup();
    await expect(test.invoke('status', {})).rejects.toThrow('Invalid');
    await expect(test.invoke('setContext', { ...scope, privatePath: '/secret' })).rejects.toThrow(
      'Invalid',
    );
    await expect(test.invoke('enable', { port: 80 })).rejects.toThrow('port');
    await expect(test.invoke('enable', { host: '0.0.0.0' })).rejects.toThrow('port');
    expect(test.handlers.size).toBe(5);
  });
  it('serializes calls, waits for ack, and rejects queued and in-flight commands after page changes', async () => {
    const test = setup();
    const client = await clientFor(test);
    const first = client.callTool({
      name: 'rename_nodes',
      arguments: { updates: [{ nodeId: 'node-1', name: 'A' }] },
    });
    await vi.waitFor(() =>
      expect(test.sent.filter((item) => item.channel === 'folioMcp:command')).toHaveLength(1),
    );
    const second = client.callTool({
      name: 'rename_nodes',
      arguments: { updates: [{ nodeId: 'node-1', name: 'B' }] },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(test.sent.filter((item) => item.channel === 'folioMcp:command')).toHaveLength(1);
    await test.invoke('setContext', { ...scope, pageId: 'page-2', epoch: 'epoch-2' });
    expect(JSON.stringify(await first)).toContain('STALE_DOCUMENT');
    expect(JSON.stringify(await second)).toContain('STALE_DOCUMENT');
    expect(test.sent.filter((item) => item.channel === 'folioMcp:command')).toHaveLength(1);
    await test.invoke('reply', {
      id: test.sent[0].payload.id,
      ok: true,
      result: { data: { ignored: true } },
    });
  });
  it('delivers successful acknowledgements and handles renderer error codes without private text', async () => {
    const test = setup();
    const client = await clientFor(test);
    const pending = client.callTool({ name: 'get_basic_info', arguments: {} });
    await vi.waitFor(() => expect(test.sent).toHaveLength(1));
    await test.invoke('reply', {
      id: test.sent[0].payload.id,
      ok: true,
      result: { data: { documentId: 'doc-1', name: 'Current' } },
    });
    expect((await pending).structuredContent.name).toBe('Current');
    const failed = client.callTool({ name: 'get_selection', arguments: {} });
    await vi.waitFor(() => expect(test.sent).toHaveLength(2));
    await test.invoke('reply', {
      id: test.sent[1].payload.id,
      ok: false,
      code: 'SECRET/private/path',
    });
    expect(JSON.stringify(await failed)).toContain('INTERNAL');
    expect(JSON.stringify(await failed)).not.toContain('SECRET');
  });
  it('cancels requests when the renderer fails or misses its deadline', async () => {
    const test = setup({ commandTimeoutMs: 100 });
    const client = await clientFor(test);
    const pending = client.callTool({ name: 'get_basic_info', arguments: {} });
    expect(JSON.stringify(await pending)).toContain('CANCELLED');
    expect(test.sent.some((item) => item.channel === 'folioMcp:cancel')).toBe(true);
    test.bridge.rendererGone();
    expect(
      JSON.stringify(await client.callTool({ name: 'get_basic_info', arguments: {} })),
    ).toContain('NOT_READY');
  });
  it('exposes only the separate frozen MCP namespace and removes event objects from subscriptions', async () => {
    const exposed = {};
    const listeners = new Map();
    const invoke = vi.fn(async () => 'ok');
    const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8');
    runInNewContext(preload, {
      require: (name) => {
        expect(name).toBe('electron');
        return {
          contextBridge: {
            exposeInMainWorld: (name, value) => {
              exposed[name] = value;
            },
          },
          ipcRenderer: {
            invoke,
            on: (channel, listener) => listeners.set(channel, listener),
            removeListener: (channel) => listeners.delete(channel),
          },
        };
      },
    });
    expect(Object.keys(exposed)).toEqual(['folioMcp']);
    expect(Object.keys(exposed.folioMcp)).toEqual([
      'status',
      'enable',
      'disable',
      'setContext',
      'reply',
      'onCommand',
      'onCancel',
    ]);
    expect(Object.isFrozen(exposed.folioMcp)).toBe(true);
    const callback = vi.fn();
    const stop = exposed.folioMcp.onCommand(callback);
    listeners.get('folioMcp:command')({ rawIpc: true }, { id: 'safe' });
    expect(callback).toHaveBeenCalledWith({ id: 'safe' });
    stop();
    expect(listeners.size).toBe(0);
    await exposed.folioMcp.enable();
    expect(invoke).toHaveBeenCalledWith('folioMcp:enable', {});
  });
});
