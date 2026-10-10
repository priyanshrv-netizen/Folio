import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { registerMcpBridge } from '../../desktop/mcp/bridge.mjs';
import type { TestControl } from './testing/fixture';

let vite: ViteDevServer;
let browser: Browser;
let page: Page;
let client: Client;
let bridge: ReturnType<typeof registerMcpBridge>;
let externalRequests: string[] = [];

function browserPath() {
  const expected = chromium.executablePath();
  if (existsSync(expected)) return expected;
  const root = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : '';
  if (root && existsSync(root))
    for (const revision of readdirSync(root)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort()
      .reverse()) {
      for (const folder of ['chrome-win64', 'chrome-win']) {
        const candidate = join(root, revision, folder, 'chrome.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  return expected;
}

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
  if (!address || typeof address === 'string') throw new Error('Test Vite server did not bind.');
  const origin = `http://127.0.0.1:${address.port}`;
  const entryUrl = `${origin}/src/mcp/testing/fixture.html`;
  browser = await chromium.launch({ executablePath: browserPath(), headless: true });
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
          const deliver = (
            window as unknown as { __mcpDeliver: (channel: string, payload: unknown) => void }
          ).__mcpDeliver;
          deliver(channel, payload);
        },
        { channel, payload },
      );
    },
  };
  const windowMock = { isDestroyed: () => page.isClosed(), webContents: contents };
  bridge = registerMcpBridge(
    {
      handle: (
        channel: string,
        handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
      ) => handlers.set(channel, handler),
    },
    () => windowMock,
    entryUrl,
  );
  await page.exposeFunction('__mcpInvoke', (method: string, args: unknown[]) =>
    handlers.get(`folioMcp:${method}`)!({ sender: contents, senderFrame: frame }, ...args),
  );
  await page.addInitScript(() => {
    const calls = window as unknown as {
      __mcpInvoke: (method: string, args: unknown[]) => Promise<unknown>;
      __mcpDeliver: (channel: string, payload: unknown) => void;
    };
    const listeners = new Map<string, (payload: never) => void>();
    calls.__mcpDeliver = (channel, payload) => listeners.get(channel)?.(payload as never);
    const invoke = (method: string, ...args: unknown[]) => calls.__mcpInvoke(method, args);
    window.folioMcp = {
      status: () => invoke('status'),
      enable: (options = {}) => invoke('enable', options),
      disable: () => invoke('disable'),
      setContext: (context) => invoke('setContext', context),
      reply: (reply) => invoke('reply', reply),
      onCommand: (callback) => {
        listeners.set('folioMcp:command', callback);
        return () => {
          listeners.delete('folioMcp:command');
        };
      },
      onCancel: (callback) => {
        listeners.set('folioMcp:cancel', callback);
        return () => {
          listeners.delete('folioMcp:cancel');
        };
      },
    } as NonNullable<Window['folioMcp']>;
  });
  await page.goto(entryUrl);
  await page.waitForFunction(() => Boolean(window.mcpTest?.document));
  let endpoint: string | undefined;
  for (let port = 32200; port < 32300; port++) {
    try {
      endpoint =
        (await page.evaluate((port) => window.folioMcp!.enable({ port }), port)).endpoint ??
        undefined;
      break;
    } catch {}
  }
  if (!endpoint) throw new Error('Could not bind an MCP integration test port.');
  client = new Client({ name: 'renderer-integration', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
}, 60_000);

afterAll(async () => {
  await client?.close();
  await bridge?.close();
  await browser?.close();
  await vite?.close();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return result;
}
async function state() {
  return page.evaluate(() => {
    const state: TestControl = window.mcpTest!;
    return { document: state.document!, selected: state.selected, commits: state.commits };
  });
}

describe('real SDK to React editor transaction integration', () => {
  it('creates editable flex HTML in one transaction, saves it, and undoes the entire batch', async () => {
    const before = await state();
    const result = await call('write_html', {
      html: '<section data-name="Card" style="display:flex;flex-direction:row;gap:12px;padding:16px;background:#ffffff;width:400px"><div style="width:120px;height:60px;background:#ff0000"></div><p style="font-size:20px;color:#123456">Hello MCP</p></section>',
      x: 20,
      y: 30,
      width: 400,
    });
    expect(result.structuredContent).toMatchObject({ applied: true, saved: true });
    const after = await state();
    expect(after.commits - before.commits).toBe(1);
    const created = after.document.pages[0].nodes.slice(before.document.pages[0].nodes.length);
    expect(created).toHaveLength(4);
    expect(created.find((node) => node.text === 'Hello MCP')).toMatchObject({
      x: 148,
      y: 16,
      width: 236,
      fontSize: 20,
      fill: '#123456',
    });
    expect(after.selected).toEqual([created[0].id]);
    await page.evaluate(() => window.mcpTest!.undo());
    await page.waitForFunction(
      (length) => window.mcpTest!.document!.pages[0].nodes.length === length,
      before.document.pages[0].nodes.length,
    );
  });
  it('rejects active HTML and unsupported CSS without requests, execution, or partial edits', async () => {
    const attacks = [
      '<script>window.hacked=true</script>',
      '<img src="https://evil.test/collect">',
      '<iframe src="https://evil.test"></iframe>',
      '<div onclick="alert(1)">Click</div>',
      '<div style="background:url(https://evil.test)">X</div>',
      '<style>@import "https://evil.test"</style>',
      '<svg><script>alert(1)</script></svg>',
      '<div style="position:absolute;left:0">X</div>',
      '<div class="external">X</div>',
      '<div style="width:50%">X</div>',
      '<p><br onclick="alert(1)">X</p>',
      '<div style="--x:url(https://evil.test)">X</div>',
    ];
    const before = await state();
    externalRequests = [];
    for (const html of attacks)
      expect((await client.callTool({ name: 'write_html', arguments: { html } })).isError).toBe(
        true,
      );
    expect((await state()).document).toEqual(before.document);
    expect((await state()).commits).toBe(before.commits);
    expect(externalRequests).toEqual([]);
    expect(await page.evaluate(() => 'hacked' in window)).toBe(false);
  });
  it('captures only requested node artwork as real PNG pixels, not the credential dialog', async () => {
    const created = await call('create_nodes', {
      nodes: [{ type: 'rectangle', id: 'screenshot-red', width: 80, height: 40, fill: '#ff0000' }],
    });
    expect(created.structuredContent).toMatchObject({ saved: true });
    const screenshot = await call('get_screenshot', { nodeId: 'screenshot-red' });
    const image = screenshot.content as { type: string; data?: string }[];
    const png = image.find((content) => content.type === 'image')?.data;
    expect(png).toBeTruthy();
    expect(screenshot.structuredContent).toMatchObject({
      width: 80,
      height: 40,
      nodeId: 'screenshot-red',
    });
    const pixel = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return [...context.getImageData(40, 20, 1, 1).data];
    }, png);
    expect(pixel).toEqual([255, 0, 0, 255]);
    expect(JSON.stringify(screenshot)).not.toContain('PRIVATE_PROVIDER_KEY');
  });
  it('exports applied shader fills as rendered PNGs in SVG, HTML, JSX and screenshots', async () => {
    const presets = await call('list_shader_presets');
    const values = (presets.structuredContent as Record<string, unknown>).presets as {
      id: string;
      config: Record<string, unknown>;
    }[];
    const config = values.find((preset) => preset.id === 'waves')!.config;
    await call('apply_shader', { nodeIds: ['screenshot-red'], config });
    const svg = await call('export', { format: 'svg', nodeId: 'screenshot-red' });
    expect((svg.structuredContent as Record<string, unknown>).content).toContain(
      'data:image/png;base64,',
    );
    const html = await call('export', { format: 'html', nodeId: 'screenshot-red' });
    expect((html.structuredContent as Record<string, unknown>).content).toContain(
      'data:image/png;base64,',
    );
    const jsx = await call('get_jsx', { nodeId: 'screenshot-red' });
    expect((jsx.structuredContent as Record<string, unknown>).code).toContain(
      'data:image/png;base64,',
    );
    const screenshot = await call('get_screenshot', { nodeId: 'screenshot-red' });
    expect(screenshot.structuredContent).toMatchObject({ width: 80, height: 40 });
    const image = (screenshot.content as { type: string; data?: string }[]).find(
      (content) => content.type === 'image',
    )!;
    const colors = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set<string>();
      for (let index = 0; index < pixels.length; index += 4)
        colors.add(
          `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`,
        );
      return colors.size;
    }, image.data);
    expect(colors).toBeGreaterThan(1);
  }, 20_000);
  it('rejects stale document/page guards and an editor page-switch racing the functional commit', async () => {
    const before = await state();
    await call('create_page', { name: 'Other page' });
    const stale = await client.callTool({
      name: 'create_nodes',
      arguments: { documentId: 'old-document', nodes: [{ type: 'rectangle' }] },
    });
    expect(stale.isError).toBe(true);
    const count = (await state()).document.pages[0].nodes.length;
    await page.evaluate(() => window.mcpTest!.prepareSwitch());
    const raced = await client.callTool({
      name: 'create_nodes',
      arguments: { nodes: [{ type: 'rectangle', id: 'must-not-commit' }] },
    });
    expect(raced.isError).toBe(true);
    const after = await state();
    expect(after.document.activePageId).not.toBe(before.document.activePageId);
    expect(after.document.pages[0].nodes).toHaveLength(count);
    expect(
      after.document.pages
        .flatMap((page) => page.nodes)
        .some((node) => node.id === 'must-not-commit'),
    ).toBe(false);
  });
});
