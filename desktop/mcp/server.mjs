import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ALL_TOOL_DEFINITIONS, TOOL_DEFINITIONS, parseTool } from './tools.mjs';
import { ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MCP_API_VERSION, MCP_INSTRUCTIONS } from './capabilities.mjs';

export const MAX_REQUEST_BYTES = 1024 * 1024;
export const MAX_RESULT_BYTES = 8 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 20_000;
export const ERROR_MESSAGES = Object.freeze({
  STALE_DOCUMENT:
    'The active document or page changed. Read get_basic_info and retry deliberately.',
  NOT_READY: 'Open a document in Folio before using this tool.',
  INVALID_ARGUMENT:
    'The operation is invalid. Check IDs, parent relationships, values, and document limits. No changes were committed.',
  NOT_FOUND:
    'A requested node or page does not exist in the active scope. No changes were committed.',
  UNSUPPORTED_HTML:
    'HTML contains unsupported tags, attributes, styles, layout values, or excessive nesting. No changes were committed. See write_html tool description.',
  LIMIT_EXCEEDED:
    'The request, response, or document exceeds the supported limit. Use smaller batches or select a node subtree.',
  CANCELLED:
    'The request was cancelled or timed out. Inspect the document before retrying a mutation.',
  CAPTURE_FAILED:
    'The isolated artwork could not be rasterized. Try exporting a smaller node as SVG.',
  UNSUPPORTED_OPERATION:
    'This operation is outside the supported Folio compatibility subset. Read get_capabilities or get_guide. No changes were committed.',
  INTERNAL: 'Folio could not complete the operation. No private runtime details are exposed.',
});

export class McpBridgeError extends Error {
  constructor(code) {
    super(Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.INTERNAL);
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'INTERNAL';
  }
}

function resultFor(result) {
  if (
    !result ||
    typeof result.data !== 'object' ||
    result.data === null ||
    Array.isArray(result.data)
  )
    throw new McpBridgeError('INTERNAL');
  const text = result.text ?? JSON.stringify(result.data);
  if (typeof text !== 'string') throw new McpBridgeError('INTERNAL');
  if (Buffer.byteLength(text) + (result.image?.data?.length ?? 0) > MAX_RESULT_BYTES)
    throw new McpBridgeError('LIMIT_EXCEEDED');
  const content = [{ type: 'text', text }];
  if (result.image) {
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(result.image.mimeType) ||
      typeof result.image.data !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(result.image.data)
    )
      throw new McpBridgeError('INTERNAL');
    content.push({ type: 'image', data: result.image.data, mimeType: result.image.mimeType });
  }
  const output = { content, structuredContent: result.data };
  if (Buffer.byteLength(JSON.stringify(output)) > MAX_RESULT_BYTES)
    throw new McpBridgeError('LIMIT_EXCEEDED');
  return output;
}

export function createSdkServer(
  dispatch,
  signal = new AbortController().signal,
  { protocolResults = false } = {},
) {
  const server = new McpServer(
    { name: 'folio-local', version: MCP_API_VERSION },
    {
      instructions: MCP_INSTRUCTIONS,
      maxToolInputElements: 20_000,
    },
  );
  for (const tool of ALL_TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: !tool.mutating,
          destructiveHint: tool.mutating,
          openWorldHint: false,
          idempotentHint: !tool.mutating,
        },
      },
      async (args, extra) => {
        try {
          try {
            parseTool(tool.name, args);
          } catch {
            throw new McpBridgeError('INVALID_ARGUMENT');
          }
          const result = await dispatch(tool.name, args, {
            signal: AbortSignal.any([signal, extra.signal]),
          });
          return protocolResults ? result : resultFor(result);
        } catch (error) {
          const code = error instanceof McpBridgeError ? error.code : 'INTERNAL';
          return {
            isError: true,
            content: [{ type: 'text', text: `${code}: ${ERROR_MESSAGES[code]}` }],
          };
        }
      },
    );
  }
  server.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    if (request.params?.cursor !== undefined && request.params.cursor !== 'folio-helpers-v1')
      throw new McpError(ErrorCode.InvalidParams, 'Invalid tool cursor.');
    const offset = request.params?.cursor ? TOOL_DEFINITIONS.length : 0;
    const definitions = ALL_TOOL_DEFINITIONS.slice(offset, offset + TOOL_DEFINITIONS.length);
    return {
      tools: definitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'any' }),
        annotations: {
          readOnlyHint: !tool.mutating,
          destructiveHint: tool.mutating,
          openWorldHint: false,
          idempotentHint: !tool.mutating,
        },
      })),
      ...(offset === 0 ? { nextCursor: 'folio-helpers-v1' } : {}),
    };
  });
  return server;
}

export function isAllowedRequest(request, port) {
  const address = request.socket.remoteAddress;
  if (address !== '127.0.0.1' && address !== '::ffff:127.0.0.1') return false;
  if (Object.hasOwn(request.headers, 'origin') || Object.hasOwn(request.headers, 'sec-fetch-site'))
    return false;
  if (request.headers.host !== `127.0.0.1:${port}`) return false;
  const names = request.rawHeaders
    .filter((_value, index) => index % 2 === 0)
    .map((name) => name.toLowerCase());
  return (
    names.filter((name) => name === 'host').length === 1 &&
    !names.includes('forwarded') &&
    !names.some((name) => name.startsWith('x-forwarded-'))
  );
}

export function createLocalMcpServer({ dispatch, requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
  let http;
  let port = null;
  let lifecycle = Promise.resolve();
  const active = new Set();
  const status = () => ({
    enabled: Boolean(http?.listening),
    endpoint: http?.listening ? `http://127.0.0.1:${port}/mcp` : null,
    port: http?.listening ? port : null,
  });
  const serialized = (run) => {
    const task = lifecycle.then(run, run);
    lifecycle = task.catch(() => {});
    return task;
  };
  function refuse(response, code, text) {
    if (!response.headersSent)
      response.writeHead(code, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'close',
        'X-Content-Type-Options': 'nosniff',
      });
    response.end(text);
  }
  async function serve(request, response) {
    if (!isAllowedRequest(request, port))
      return refuse(response, 403, 'Only trusted local non-browser clients may connect.');
    if (request.url !== '/mcp') return refuse(response, 404, 'Not found.');
    if (request.method !== 'POST') return refuse(response, 405, 'Only POST is supported.');
    if (
      !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '') ||
      request.headers['content-encoding']
    )
      return refuse(response, 415, 'Uncompressed application/json is required.');
    if (active.size >= 32) return refuse(response, 429, 'Too many pending requests.');
    const controller = new AbortController();
    active.add(controller);
    let sdk;
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      controller.abort();
      active.delete(controller);
      void sdk?.close().catch(() => {});
    };
    const timer = setTimeout(() => {
      controller.abort();
      refuse(response, 408, 'Request timed out.');
      cleanup();
    }, requestTimeoutMs);
    timer.unref();
    response.once('close', cleanup);
    response.once('finish', cleanup);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const declaredLength = Number(request.headers['content-length'] ?? 0);
      if (
        !Number.isSafeInteger(declaredLength) ||
        declaredLength < 0 ||
        declaredLength > MAX_REQUEST_BYTES
      )
        return refuse(response, 413, 'Request exceeds 1 MiB.');
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        if (controller.signal.aborted) return;
        bytes += chunk.length;
        if (bytes > MAX_REQUEST_BYTES) return refuse(response, 413, 'Request exceeds 1 MiB.');
        chunks.push(chunk);
      }
      if (controller.signal.aborted) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return refuse(response, 400, 'Invalid JSON.');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return refuse(
          response,
          400,
          'One JSON-RPC request is required; batches are not supported.',
        );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        enableDnsRebindingProtection: true,
        allowedHosts: [`127.0.0.1:${port}`],
      });
      sdk = createSdkServer(dispatch, controller.signal);
      await sdk.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.writableEnded && !response.destroyed)
        refuse(response, 500, 'MCP request failed.');
      cleanup();
    }
  }
  return {
    status,
    enable(options = {}) {
      return serialized(async () => {
        const requested = options.port ?? 3100;
        if (
          !Number.isInteger(requested) ||
          requested < 0 ||
          requested > 65535 ||
          (requested > 0 && requested < 1024)
        )
          throw new Error('Choose a port from 1024 to 65535.');
        if (http?.listening) {
          if (requested !== 0 && requested !== port)
            throw new Error('Disable MCP before changing its port.');
          return status();
        }
        const next = createServer(
          {
            maxHeaderSize: 8192,
            headersTimeout: Math.min(5000, requestTimeoutMs),
            requestTimeout: requestTimeoutMs,
            keepAliveTimeout: 1000,
          },
          (request, response) => {
            void serve(request, response);
          },
        );
        next.maxConnections = 64;
        next.on('clientError', (_error, socket) => socket.destroy());
        try {
          await new Promise((resolve, reject) => {
            next.once('error', reject);
            next.listen(requested, '127.0.0.1', () => {
              next.removeListener('error', reject);
              resolve();
            });
          });
        } catch {
          throw new Error('Could not start the local MCP server. Choose another available port.');
        }
        next.on('error', () => {});
        http = next;
        port = next.address().port;
        return status();
      });
    },
    disable() {
      return serialized(async () => {
        const previous = http;
        http = undefined;
        port = null;
        for (const controller of active) controller.abort();
        if (previous)
          await new Promise((resolve) => {
            previous.close(resolve);
            previous.closeAllConnections();
          });
        return status();
      });
    },
  };
}
