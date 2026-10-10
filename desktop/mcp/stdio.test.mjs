import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createLocalMcpServer } from './server.mjs';
import { ALL_TOOL_DEFINITIONS } from './tools.mjs';
import { boundedStdioInput, localFetch, parsePort } from './stdio.mjs';

const cleanup = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});
async function stdio(port) {
  const client = new Client({ name: 'stdio-integration-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./stdio.mjs', import.meta.url)), '--port', String(port)],
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  cleanup.push(() => client.close());
  await client.connect(transport);
  return { client, stderr: () => stderr };
}

describe('Folio-owned stdio MCP adapter', () => {
  it('initializes and discovers paginated real tools even when Folio is disabled', async () => {
    const listener = createLocalMcpServer({ dispatch: vi.fn() });
    const { port } = await listener.enable({ port: 0 });
    await listener.disable();
    const { client, stderr } = await stdio(port);
    expect(client.getServerVersion()).toMatchObject({ name: 'folio-local', version: '0.2.0' });
    const first = await client.listTools();
    const second = await client.listTools({ cursor: first.nextCursor });
    expect(first.tools).toHaveLength(23);
    expect([...first.tools, ...second.tools].map((tool) => tool.name)).toEqual(
      ALL_TOOL_DEFINITIONS.map((tool) => tool.name),
    );
    expect(second.nextCursor).toBeUndefined();
    const caps = await client.callTool({ name: 'get_capabilities', arguments: {} });
    expect(caps.structuredContent.paper).toMatchObject({
      schemaCount: 36,
      outputSchemaAvailable: false,
    });
    const result = await client.callTool({
      name: 'create_artboard',
      arguments: { name: 'Cannot mutate', width: 100, height: 100 },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('NOT_READY');
    expect(stderr()).toBe('');
  }, 15_000);

  it('proxies SDK calls to enabled Folio once, preserving structured content and image results', async () => {
    const dispatch = vi.fn(async () => ({
      data: { nodeId: 'node-1', applied: true },
      image: { data: 'iVBORw0KGgo=', mimeType: 'image/png' },
    }));
    const listener = createLocalMcpServer({ dispatch });
    cleanup.push(() => listener.disable());
    const { port } = await listener.enable({ port: 0 });
    const { client, stderr } = await stdio(port);
    const result = await client.callTool({
      name: 'set_text_content',
      arguments: { fileId: 'doc-1', updates: [{ nodeId: 'text-1', textContent: 'From stdio' }] },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ nodeId: 'node-1', applied: true });
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][1]).toMatchObject({
      fileId: 'doc-1',
      updates: [{ textContent: 'From stdio' }],
    });
    await listener.disable();
    expect((await client.callTool({ name: 'get_selection', arguments: {} })).isError).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(stderr()).toBe('');
  }, 15_000);

  it.each([
    ['--url', 'https://evil.test'],
    ['--port', '80'],
    ['--port', '65536'],
    ['--port', '3100', '--host', '0.0.0.0'],
    ['--port', '3100/secret'],
    ['--port', 'NaN'],
  ])('rejects unsafe CLI arguments %j', (args) => {
    expect(() => parsePort(args)).toThrow();
  });

  it('bounds newline-framed input before the SDK buffers it', async () => {
    const input = boundedStdioInput();
    input.resume();
    const error = new Promise((resolve) => input.once('error', resolve));
    input.write(Buffer.alloc(1024 * 1024 + 1, 65));
    expect((await error).message).toContain('1 MiB');
  });

  it('refuses redirected and mismatched HTTP destinations', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(302, { Location: 'https://evil.test/collect' });
      response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(
      () =>
        new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        }),
    );
    const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
    await expect(
      localFetch(endpoint, endpoint, { signal: AbortSignal.timeout(2000) }),
    ).rejects.toThrow();
    await expect(localFetch(endpoint, `${endpoint}?path=private`)).rejects.toThrow();
  });
});
