#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Transform } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSdkServer, MAX_REQUEST_BYTES, MAX_RESULT_BYTES, McpBridgeError } from './server.mjs';
import { FOLIO_GUIDES, MCP_API_VERSION, mcpCapabilities } from './capabilities.mjs';

export function parsePort(args) {
  if (args.length === 0) return 3100;
  if (args.length !== 2 || args[0] !== '--port' || !/^\d{4,5}$/.test(args[1]))
    throw new Error('Invalid port.');
  const port = Number(args[1]);
  if (port < 1024 || port > 65535) throw new Error('Invalid port.');
  return port;
}

export function boundedStdioInput() {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      for (const byte of chunk) {
        bytes = byte === 10 ? 0 : bytes + 1;
        if (bytes > MAX_REQUEST_BYTES) return done(new Error('MCP input exceeds 1 MiB.'));
      }
      done(null, chunk);
    },
  });
}

export async function localFetch(endpoint, input, init = {}) {
  if (!/^http:\/\/127\.0\.0\.1:\d{4,5}\/mcp$/.test(endpoint))
    throw new McpBridgeError('INVALID_ARGUMENT');
  const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (address !== endpoint) throw new McpBridgeError('INVALID_ARGUMENT');
  const response = await fetch(endpoint, { ...init, redirect: 'error', credentials: 'omit' });
  if (Number(response.headers.get('content-length')) > MAX_RESULT_BYTES) {
    await response.body?.cancel();
    throw new McpBridgeError('LIMIT_EXCEEDED');
  }
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESULT_BYTES) throw new McpBridgeError('LIMIT_EXCEEDED');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return new Response(bytes ? Buffer.concat(chunks) : null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createStdioProxy(port = 3100) {
  parsePort(['--port', String(port)]);
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const controller = new AbortController();
  let pending = 0;
  const server = createSdkServer(
    async (name, args, { signal }) => {
      if (name === 'get_capabilities' || name === 'get_guide') {
        const data =
          name === 'get_capabilities'
            ? mcpCapabilities()
            : { topic: args.topic, content: FOLIO_GUIDES[args.topic], implementation: 'Folio' };
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      }
      if (pending >= 32) throw new McpBridgeError('LIMIT_EXCEEDED');
      if (Buffer.byteLength(JSON.stringify(args)) > MAX_REQUEST_BYTES)
        throw new McpBridgeError('LIMIT_EXCEEDED');
      pending += 1;
      const client = new Client({ name: 'folio-stdio-proxy', version: MCP_API_VERSION });
      const deadline = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(18_000)]);
      let sent = false;
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(endpoint), {
            fetch: (input, init) =>
              localFetch(endpoint, input, {
                ...init,
                signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]),
              }),
          }),
          { timeout: 5000, signal: deadline },
        );
        if (client.getServerVersion()?.name !== 'folio-local')
          throw new McpBridgeError('NOT_READY');
        deadline.throwIfAborted();
        sent = true;
        return await client.callTool({ name, arguments: args }, undefined, {
          timeout: 16_000,
          signal: deadline,
        });
      } catch (error) {
        if (error instanceof McpBridgeError) throw error;
        throw new McpBridgeError(sent ? 'CANCELLED' : 'NOT_READY');
      } finally {
        pending -= 1;
        await client.close().catch(() => {});
      }
    },
    controller.signal,
    { protocolResults: true },
  );
  return {
    server,
    async close() {
      controller.abort();
      await server.close();
    },
  };
}

async function main() {
  let port;
  try {
    port = parsePort(process.argv.slice(2));
  } catch {
    process.stderr.write('Usage: node desktop/mcp/stdio.mjs [--port 1024..65535]\n');
    process.exitCode = 1;
    return;
  }
  const proxy = createStdioProxy(port);
  const input = boundedStdioInput();
  const transport = new StdioServerTransport(input, process.stdout);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    process.stdin.unpipe(input);
    process.stdin.pause();
    void proxy.close().catch(() => {});
  };
  input.on('error', () => {
    process.stderr.write('Folio MCP input rejected.\n');
    close();
  });
  process.stdin.once('end', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await proxy.server.connect(transport);
  process.stdin.pipe(input);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Folio MCP adapter could not start.\n');
    process.exitCode = 1;
  });
}
