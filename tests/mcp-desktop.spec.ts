import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a real MCP client edits the desktop canvas, captures shaders, persists changes, and shuts down', async () => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), 'folio-mcp-desktop-'));
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  let application: ElectronApplication | undefined;
  const client = new Client({ name: 'folio-desktop-e2e', version: '1.0.0' });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    return result.structuredContent as Record<string, unknown>;
  };
  try {
    application = await electron.launch({
      args: ['.'],
      cwd: process.cwd(),
      env: { ...process.env, FOLIO_DATA_DIR: directory },
    });
    let page = await application.firstWindow();
    await expect(page.getByRole('textbox', { name: 'Document name' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(async () => (await window.folioMcp?.status())?.rendererReady))
      .toBe(true);
    expect(await page.evaluate(async () => (await window.folioMcp?.status())?.enabled)).toBe(false);
    await page.getByRole('button', { name: 'File menu', exact: true }).click();
    await page.getByRole('button', { name: 'New file', exact: false }).click();
    await page.getByRole('textbox', { name: 'Document name' }).fill('Agent collaboration proof');
    await page.getByRole('textbox', { name: 'Document name' }).press('Enter');
    await page.getByRole('button', { name: 'Connect agents', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'MCP port' }).fill(String(port));
    await page.getByRole('button', { name: 'Enable MCP', exact: true }).click();
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    await expect(page.getByRole('textbox', { name: 'MCP endpoint' })).toHaveValue(endpoint);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
    const catalog = await client.listTools();
    expect(catalog.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'get_basic_info',
        'get_selection',
        'create_artboard',
        'write_html',
        'get_screenshot',
        'apply_shader',
        'get_jsx',
      ]),
    );
    const info = await call('get_basic_info');
    const scope = { documentId: info.documentId, pageId: info.pageId };
    const artboard = await call('create_artboard', {
      ...scope,
      name: 'Agent artboard',
      width: 640,
      height: 420,
    });
    expect(artboard.saved).toBe(true);
    const artboardId = (artboard.nodeIds as string[])[0];
    await expect(
      page.getByRole('button', { name: 'Select layer Agent artboard', exact: true }),
    ).toBeVisible();
    const created = await call('create_nodes', {
      ...scope,
      nodes: [
        {
          type: 'text',
          parentId: artboardId,
          name: 'Agent headline',
          x: 30,
          y: 40,
          width: 550,
          height: 70,
          fontSize: 40,
          fill: '#ffffff',
          text: 'Made with an agent.',
        },
      ],
    });
    const textId = (created.nodeIds as string[])[0];
    await expect(page.locator('.node-text')).toHaveText('Made with an agent.');
    await call('set_text_content', {
      ...scope,
      updates: [{ nodeId: textId, text: 'A shared canvas.' }],
    });
    await expect(page.locator('.node-text')).toHaveText('A shared canvas.');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.node-text')).toHaveText('Made with an agent.');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.locator('.node-text')).toHaveText('A shared canvas.');
    const presets = await call('list_shader_presets');
    const preset = (presets.presets as { id: string; config: unknown }[]).find(
      (item) => item.id === 'mesh-gradient',
    )!;
    await call('apply_shader', { ...scope, nodeIds: [artboardId], config: preset.config });
    await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-status', 'ready');
    await call('write_html', {
      ...scope,
      parentId: artboardId,
      x: 30,
      y: 170,
      width: 280,
      html: '<div data-name="Agent card" style="display:flex;flex-direction:column;width:280px;padding:16px;gap:8px;background:#ffffff;border-radius:8px"><h2 style="font-size:20px;color:#222222">Editable HTML</h2><p style="font-size:13px;color:#555555">Created through the local MCP server.</p></div>',
    });
    await expect(
      page.getByRole('button', { name: 'Select layer Agent card', exact: true }),
    ).toBeVisible();
    const capture = await client.callTool({
      name: 'get_screenshot',
      arguments: { ...scope, nodeId: artboardId },
    });
    expect(capture.isError, JSON.stringify(capture.content)).not.toBe(true);
    const image = (capture.content as { type: string; data?: string }[]).find(
      (item) => item.type === 'image',
    )!;
    expect(Buffer.from(image.data!, 'base64').subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const exported = await call('export', { ...scope, nodeId: artboardId, format: 'svg' });
    expect(exported.content).toContain('data:image/png;base64,');
    expect(exported.content).toContain('A shared canvas.');
    const bad = await client.callTool({
      name: 'write_html',
      arguments: {
        ...scope,
        parentId: artboardId,
        html: '<img src="https://example.test/tracker" onerror="alert(1)">',
      },
    });
    expect(bad.isError).toBe(true);
    const webRequest = await fetch(endpoint, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(webRequest.status).toBe(403);
    await page.getByRole('button', { name: 'Connect agents', exact: true }).click();
    await page.getByRole('button', { name: 'Disable MCP', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enable MCP', exact: true })).toBeVisible();
    await client.close();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
    await application.close();
    application = await electron.launch({
      args: ['.'],
      cwd: process.cwd(),
      env: { ...process.env, FOLIO_DATA_DIR: directory },
    });
    page = await application.firstWindow();
    await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue(
      'Agent collaboration proof',
    );
    await expect(page.locator('.node-text').filter({ hasText: 'A shared canvas.' })).toHaveCount(1);
    await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-status', 'ready');
    expect(await page.evaluate(async () => (await window.folioMcp?.status())?.enabled)).toBe(false);
  } finally {
    await client.close().catch(() => {});
    await application?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
