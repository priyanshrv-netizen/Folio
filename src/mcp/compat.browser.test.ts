import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { registerMcpBridge } from '../../desktop/mcp/bridge.mjs';
import type { McpRequest, McpStatus } from './types';
import type { TestControl } from './testing/fixture';

let vite: ViteDevServer;
let browser: Browser;
let page: Page;
let client: Client;
let bridge: ReturnType<typeof registerMcpBridge>;
let externalRequests: string[] = [];
let fileId: string;
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=';
beforeAll(async () => {
  vite = await createServer({
    configFile: false,
    root: process.cwd(),
    plugins: [react()],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  await vite.listen();
  const address = vite.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('No test server.');
  const origin = `http://127.0.0.1:${address.port}`;
  const entryUrl = `${origin}/src/mcp/testing/fixture.html`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (!url.startsWith(`${origin}/`) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      externalRequests.push(url);
      await route.abort();
    } else await route.continue();
  });
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const frame = { url: entryUrl };
  const contents = {
    mainFrame: frame,
    send: (channel: string, payload: unknown) => {
      void page.evaluate(
        ({ channel, payload }) => {
          (window as unknown as { deliver: (channel: string, payload: unknown) => void }).deliver(
            channel,
            payload,
          );
        },
        { channel, payload },
      );
    },
  };
  bridge = registerMcpBridge(
    {
      handle: (
        channel: string,
        handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
      ) => handlers.set(channel, handler),
    },
    () => ({ isDestroyed: () => page.isClosed(), webContents: contents }),
    entryUrl,
  );
  await page.exposeFunction('__compatInvoke', (method: string, args: unknown[]) =>
    handlers.get(`folioMcp:${method}`)!({ sender: contents, senderFrame: frame }, ...args),
  );
  await page.addInitScript(() => {
    const target = window as unknown as {
      __compatInvoke: (method: string, args: unknown[]) => Promise<unknown>;
      deliver: (channel: string, payload: unknown) => void;
    };
    const listeners = new Map<string, (value: never) => void>();
    target.deliver = (channel, payload) => listeners.get(channel)?.(payload as never);
    const invoke = (method: string, ...args: unknown[]) => target.__compatInvoke(method, args);
    window.folioMcp = {
      status: () => invoke('status') as Promise<McpStatus>,
      enable: (options = {}) => invoke('enable', options) as Promise<McpStatus>,
      disable: () => invoke('disable') as Promise<McpStatus>,
      setContext: (context) => invoke('setContext', context) as Promise<void>,
      reply: (reply) => invoke('reply', reply) as Promise<void>,
      onCommand: (callback: (value: McpRequest) => void) => {
        listeners.set('folioMcp:command', callback);
        return () => {
          listeners.delete('folioMcp:command');
        };
      },
      onCancel: (callback: (value: string) => void) => {
        listeners.set('folioMcp:cancel', callback);
        return () => {
          listeners.delete('folioMcp:cancel');
        };
      },
    };
  });
  await page.goto(entryUrl);
  await page.waitForFunction(() => Boolean(window.mcpTest?.document));
  const status = await page.evaluate(async () => {
    for (let port = 32400; port < 32500; port++) {
      try {
        return await window.folioMcp!.enable({ port });
      } catch {}
    }
    throw new Error('No free test MCP port.');
  });
  client = new Client({ name: 'browser-paper-contract-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(status.endpoint!)));
  fileId = (await state()).document!.id;
}, 30000);
afterAll(async () => {
  await client?.close();
  await bridge?.close();
  await browser?.close();
  await vite?.close();
});
const state = () =>
  page.evaluate(() => ({
    document: window.mcpTest!.document,
    selected: window.mcpTest!.selected,
    commits: window.mcpTest!.commits,
  })) as Promise<Pick<TestControl, 'document' | 'selected' | 'commits'>>;
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({
    name,
    arguments: { fileId, ...args },
  })) as CallToolResult;
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return result;
}

describe('actual renderer Paper-shaped MCP workflows', () => {
  it('creates persistent flex artboards and imports editable named children in one commit', async () => {
    const board = await call('create_artboard', {
      name: 'Compatible flex',
      styles: {
        width: '400px',
        height: '300px',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px',
        gap: '12px',
      },
    });
    const nodeId = board.structuredContent!.nodeId as string;
    const before = await state();
    const result = await call('write_html', {
      targetNodeId: nodeId,
      mode: 'insert-children',
      html: '<div layer-name="First" style="height:60px;background:rgb(255,0,0)"></div><p layer-name="Title" style="font-size:20px">Actual text</p>',
    });
    const after = await state();
    expect(after.commits - before.commits).toBe(1);
    const nodes = after.document!.pages[0].nodes;
    const parent = nodes.find((node) => node.id === nodeId)!;
    expect(parent.layout).toMatchObject({ direction: 'column', paddingLeft: 20, gap: 12 });
    const children = nodes.filter((node) => node.parentId === nodeId);
    expect(children).toHaveLength(2);
    expect(children[0]).toMatchObject({
      name: 'First',
      x: 20,
      y: 20,
      width: 360,
      height: 60,
      fill: '#ff0000',
    });
    expect(children[1]).toMatchObject({ name: 'Title', x: 20, y: 92, text: 'Actual text' });
    expect(result.structuredContent!.nodeIds).toHaveLength(2);
    const patched = await call('update_styles', {
      updates: [{ nodeIds: [nodeId], styles: { gap: '24px', paddingLeft: '30px' } }],
    });
    expect(patched.structuredContent!.saved).toBe(true);
    expect(
      (await state()).document!.pages[0].nodes.find((node) => node.id === children[1].id)!.y,
    ).toBe(104);
    await page.evaluate(() => window.mcpTest!.undo());
    await page.waitForFunction(
      ({ id, y }) =>
        window.mcpTest!.document!.pages[0].nodes.find((node) => node.id === id)?.y === y,
      { id: children[1].id, y: 92 },
    );
  });

  it('replaces a target subtree atomically and preserves sibling position', async () => {
    const parent = await call('create_nodes', {
      nodes: [
        { id: 'replace-host', type: 'frame', width: 300, height: 200 },
        { id: 'replace-before', type: 'rectangle', parentId: 'replace-host' },
        { id: 'replace-target', type: 'frame', parentId: 'replace-host', x: 50, y: 70 },
        { id: 'replace-child', type: 'text', parentId: 'replace-target', text: 'Old' },
        { id: 'replace-after', type: 'rectangle', parentId: 'replace-host' },
      ],
    });
    expect(parent.structuredContent!.applied).toBe(true);
    const before = await state();
    const result = await call('write_html', {
      targetNodeId: 'replace-target',
      mode: 'replace',
      html: '<p layer-name="Replacement" style="width:120px;height:40px">New text</p>',
    });
    const after = await state();
    expect(after.commits - before.commits).toBe(1);
    const nodes = after.document!.pages[0].nodes;
    expect(nodes.some((node) => ['replace-target', 'replace-child'].includes(node.id))).toBe(false);
    const root = (result.structuredContent!.rootIds as string[])[0];
    expect(nodes.find((node) => node.id === root)).toMatchObject({
      parentId: 'replace-host',
      x: 50,
      y: 70,
      text: 'New text',
    });
    expect(nodes.filter((node) => node.parentId === 'replace-host').map((node) => node.id)).toEqual(
      ['replace-before', root, 'replace-after'],
    );
    await page.evaluate(() => window.mcpTest!.undo());
    await page.waitForFunction(() =>
      window.mcpTest!.document!.pages[0].nodes.some((node) => node.id === 'replace-child'),
    );
  });

  it('rejects active content, URLs and unsupported styles before replacing any nodes or fetching', async () => {
    const before = await state();
    externalRequests = [];
    for (const html of [
      '<script>window.hacked=true</script>',
      '<img src="paper-asset:///secret.png">',
      '<div layer-name="Bad" onmouseover="alert(1)">X</div>',
      '<div style="background:url(https://evil.test)">X</div>',
      '<div style="display:grid">X</div>',
    ]) {
      const result = await client.callTool({
        name: 'write_html',
        arguments: { fileId, targetNodeId: 'replace-target', mode: 'replace', html },
      });
      expect(result.isError).toBe(true);
    }
    expect((await state()).document).toEqual(before.document);
    expect((await state()).commits).toBe(before.commits);
    expect(externalRequests).toEqual([]);
    expect(await page.evaluate(() => 'hacked' in window)).toBe(false);
  });

  it('exports actual image bytes, extracts embedded fills, and checks fonts without revealing unrelated dialogs', async () => {
    await call('create_nodes', {
      nodes: [{ id: 'raster-image', type: 'image', src: PNG, width: 30, height: 20 }],
    });
    const fill = await call('get_fill_image', { nodeId: 'raster-image' });
    expect(
      (fill.content as { type: string; mimeType?: string }[]).some(
        (item) => item.type === 'image' && item.mimeType === 'image/jpeg',
      ),
    ).toBe(true);
    const result = await call('export', {
      nodes: {
        'raster-image': [
          { format: 'png', scale: '2x' },
          { format: 'jpg', scale: '60w' },
          { format: 'webp', scale: '20h' },
          { format: 'svg', scale: '1x' },
        ],
      },
      type: 'image',
    });
    expect(result.structuredContent!.exports).toMatchObject([
      { width: 60, height: 40, mimeType: 'image/png' },
      { mimeType: 'image/jpeg' },
      { mimeType: 'image/webp' },
      { mimeType: 'image/svg+xml' },
    ]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_KEY');
    const fonts = await call('get_font_family_info', {
      familyNames: ['Arial', 'system-ui', 'Untrusted Font'],
    });
    expect(fonts.structuredContent!.families).toMatchObject([
      { supported: true },
      { available: true },
      { supported: false, available: false },
    ]);
    expect(externalRequests).toEqual([]);
  });
});
