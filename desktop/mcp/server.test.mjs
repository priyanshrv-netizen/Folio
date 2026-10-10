import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  createLocalMcpServer,
  isAllowedRequest,
  MAX_REQUEST_BYTES,
  McpBridgeError,
} from './server.mjs';
import { TOOL_DEFINITIONS } from './tools.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function setup(
  dispatch = vi.fn(async () => ({ data: { documentId: 'doc-1', pageId: 'page-1' } })),
  options = {},
) {
  const server = createLocalMcpServer({ dispatch, ...options });
  expect(server.status()).toEqual({ enabled: false, endpoint: null, port: null });
  const status = await server.enable({ port: 0 });
  cleanups.push(() => server.disable());
  return { server, dispatch, status };
}
async function clientFor(endpoint) {
  const client = new Client({ name: 'folio-protocol-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  cleanups.push(() => client.close());
  return client;
}
function raw(port, { method = 'POST', path = '/mcp', headers = {}, body = '{}' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('real SDK Streamable HTTP server', () => {
  it('initializes, lists actual schemas, and waits for the renderer acknowledgement on callTool', async () => {
    let acknowledge;
    const dispatch = vi.fn(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const { status } = await setup(dispatch);
    const client = await clientFor(status.endpoint);
    expect(client.getServerVersion().name).toBe('folio-local');
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(
      TOOL_DEFINITIONS.map((tool) => tool.name),
    );
    expect(listed.tools).toHaveLength(23);
    expect(
      listed.tools.find((tool) => tool.name === 'write_html').inputSchema.properties.html,
    ).toBeDefined();
    let complete = false;
    const pending = client
      .callTool({
        name: 'create_artboard',
        arguments: { name: 'SDK board', width: 640, height: 480 },
      })
      .then((value) => {
        complete = true;
        return value;
      });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(complete).toBe(false);
    expect(dispatch.mock.calls[0][1]).toMatchObject({ name: 'SDK board', width: 640, height: 480 });
    acknowledge({
      data: {
        documentId: 'doc-1',
        pageId: 'page-1',
        nodeIds: ['board-1'],
        applied: true,
        saved: true,
      },
    });
    const result = await pending;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ nodeIds: ['board-1'], saved: true });
  });

  it('validates arguments before dispatch and sanitizes private runtime errors', async () => {
    const dispatch = vi.fn(async () => {
      throw new Error('SECRET private/path/provider-key');
    });
    const { status } = await setup(dispatch);
    const client = await clientFor(status.endpoint);
    const invalid = await client.callTool({
      name: 'update_styles',
      arguments: { updates: [{ nodeIds: ['node-1'], styles: { fill: 'url(https://evil.test)' } }] },
    });
    expect(invalid.isError).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    const failed = await client.callTool({ name: 'get_basic_info', arguments: {} });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain('SECRET');
    expect(JSON.stringify(failed)).toContain('INTERNAL');
    dispatch.mockRejectedValueOnce(new McpBridgeError('STALE_DOCUMENT'));
    const stale = await client.callTool({ name: 'get_selection', arguments: {} });
    expect(JSON.stringify(stale)).toContain('STALE_DOCUMENT');
  });

  it.each([
    { Origin: 'https://evil.test' },
    { Origin: 'null' },
    { Origin: 'http://127.0.0.1' },
    { Origin: '' },
    { Host: 'evil.test' },
    { Host: 'localhost:3100' },
    { 'Sec-Fetch-Site': 'none' },
    { Forwarded: 'for=127.0.0.1' },
    { 'X-Forwarded-Host': 'localhost' },
  ])('rejects browser, rebinding and proxy headers %j without CORS', async (headers) => {
    const { status, dispatch } = await setup();
    const result = await raw(status.port, { headers });
    expect(result.status).toBe(403);
    expect(result.headers['access-control-allow-origin']).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects remote sockets and duplicate Host headers even with a valid claimed host', () => {
    const input = {
      socket: { remoteAddress: '10.1.2.3' },
      headers: { host: '127.0.0.1:3100' },
      rawHeaders: ['Host', '127.0.0.1:3100'],
    };
    expect(isAllowedRequest(input, 3100)).toBe(false);
    input.socket.remoteAddress = '127.0.0.1';
    expect(isAllowedRequest(input, 3100)).toBe(true);
    input.rawHeaders.push('Host', 'evil.test');
    expect(isAllowedRequest(input, 3100)).toBe(false);
  });

  it('rejects preflight, arbitrary paths, compressed bodies, malformed JSON and batches', async () => {
    const { status, dispatch } = await setup();
    expect(
      (await raw(status.port, { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } }))
        .status,
    ).toBe(403);
    expect((await raw(status.port, { method: 'GET' })).status).toBe(405);
    expect((await raw(status.port, { path: '/settings' })).status).toBe(404);
    expect((await raw(status.port, { headers: { 'Content-Encoding': 'gzip' } })).status).toBe(415);
    expect((await raw(status.port, { body: '[' })).status).toBe(400);
    expect((await raw(status.port, { body: '[]' })).status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('enforces request/response size and total-time limits', async () => {
    const { status } = await setup(
      vi.fn(async () => ({ data: { content: 'x'.repeat(9 * 1024 * 1024) } })),
    );
    expect((await raw(status.port, { body: 'x'.repeat(MAX_REQUEST_BYTES + 1) })).status).toBe(413);
    const client = await clientFor(status.endpoint);
    expect(
      JSON.stringify(await client.callTool({ name: 'get_basic_info', arguments: {} })),
    ).toContain('LIMIT_EXCEEDED');
    const slow = await setup(() => new Promise(() => {}), { requestTimeoutMs: 100 });
    const timeout = await raw(slow.status.port, {
      headers: { Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_basic_info', arguments: {} },
      }),
    });
    expect(timeout.status).toBe(408);
  });

  it('closes the listener and starts disabled again after shutdown', async () => {
    const { server, status } = await setup();
    expect((await server.disable()).enabled).toBe(false);
    await expect(fetch(status.endpoint)).rejects.toThrow();
  });
});
