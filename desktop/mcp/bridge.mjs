import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createLocalMcpServer,
  ERROR_MESSAGES,
  MAX_RESULT_BYTES,
  McpBridgeError,
} from './server.mjs';

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const sameScope = (left, right) =>
  Boolean(
    left &&
    right &&
    left.documentId === right.documentId &&
    left.pageId === right.pageId &&
    left.epoch === right.epoch,
  );

export function registerMcpBridge(
  ipcMain,
  getWindow,
  entryUrl,
  { commandTimeoutMs = 15_000, serverOptions = {} } = {},
) {
  let context = null;
  let generation = 0;
  let queued = 0;
  let queue = Promise.resolve();
  const pending = new Map();
  function trusted(event) {
    const window = getWindow();
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      !event.senderFrame ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== entryUrl
    )
      throw new Error('Untrusted Folio IPC sender.');
    return window;
  }
  function cancelPending(code) {
    for (const request of pending.values()) request.fail(code);
  }
  function dispatch(name, args, { signal }) {
    if (!context) return Promise.reject(new McpBridgeError('NOT_READY'));
    if (queued >= 32) return Promise.reject(new McpBridgeError('LIMIT_EXCEEDED'));
    const scope = { ...context };
    const currentGeneration = generation;
    const deadline = Date.now() + commandTimeoutMs;
    queued += 1;
    const run = async () => {
      if (signal.aborted || Date.now() >= deadline || currentGeneration !== generation)
        throw new McpBridgeError('CANCELLED');
      if (!sameScope(scope, context)) throw new McpBridgeError('STALE_DOCUMENT');
      const window = getWindow();
      if (!window || window.isDestroyed() || window.webContents.mainFrame.url !== entryUrl)
        throw new McpBridgeError('NOT_READY');
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const cleanup = () => {
          clearTimeout(timer);
          pending.delete(id);
          signal.removeEventListener('abort', abort);
        };
        const fail = (code) => {
          cleanup();
          if (!window.isDestroyed()) window.webContents.send('folioMcp:cancel', id);
          reject(new McpBridgeError(code));
        };
        const abort = () => fail('CANCELLED');
        const timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
        timer.unref();
        signal.addEventListener('abort', abort, { once: true });
        pending.set(id, {
          scope,
          fail,
          finish(result) {
            cleanup();
            resolve(result);
          },
        });
        try {
          window.webContents.send('folioMcp:command', { id, name, args, context: scope, deadline });
        } catch {
          fail('NOT_READY');
        }
      });
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result.finally(() => {
      queued -= 1;
    });
  }
  const server = createLocalMcpServer({ ...serverOptions, dispatch });
  const status = () => {
    const current = server.status();
    return {
      ...current,
      rendererReady: Boolean(context),
      stdio: {
        command: 'node',
        args: [
          fileURLToPath(new URL('./stdio.mjs', import.meta.url)),
          '--port',
          String(current.port ?? 3100),
        ],
      },
    };
  };
  const handlers = {
    status: { arity: 0, run: () => status() },
    enable: {
      arity: 1,
      run: async (options) => {
        if (
          !options ||
          typeof options !== 'object' ||
          Array.isArray(options) ||
          Object.keys(options).some((key) => key !== 'port') ||
          (options.port !== undefined &&
            (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535))
        )
          throw new Error('Choose a port from 1024 to 65535.');
        await server.enable(options);
        return status();
      },
    },
    disable: {
      arity: 0,
      run: async () => {
        generation += 1;
        cancelPending('CANCELLED');
        await server.disable();
        return status();
      },
    },
    setContext: {
      arity: 1,
      run: (next) => {
        if (
          next !== null &&
          (!next ||
            typeof next !== 'object' ||
            Array.isArray(next) ||
            Object.keys(next).length !== 3 ||
            !['documentId', 'pageId', 'epoch'].every(
              (key) => typeof next[key] === 'string' && idPattern.test(next[key]),
            ))
        )
          throw new Error('Invalid MCP context.');
        if (!sameScope(context, next)) {
          context = next ? { ...next } : null;
          cancelPending('STALE_DOCUMENT');
        }
      },
    },
    reply: {
      arity: 1,
      run: (reply) => {
        if (
          !reply ||
          typeof reply !== 'object' ||
          typeof reply.id !== 'string' ||
          typeof reply.ok !== 'boolean'
        )
          throw new Error('Invalid MCP acknowledgement.');
        const request = pending.get(reply.id);
        if (!request) return;
        if (!sameScope(context, request.scope)) {
          request.fail('STALE_DOCUMENT');
          return;
        }
        if (!reply.ok) {
          request.fail(Object.hasOwn(ERROR_MESSAGES, reply.code) ? reply.code : 'INTERNAL');
          return;
        }
        let serialized;
        try {
          serialized = JSON.stringify(reply.result);
        } catch {
          request.fail('INTERNAL');
          return;
        }
        if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_RESULT_BYTES) {
          request.fail('LIMIT_EXCEEDED');
          return;
        }
        request.finish(reply.result);
      },
    },
  };
  for (const [method, handler] of Object.entries(handlers)) {
    ipcMain.handle(`folioMcp:${method}`, async (event, ...args) => {
      trusted(event);
      if (args.length !== handler.arity) throw new Error('Invalid Folio MCP request.');
      return handler.run(...args);
    });
  }
  return {
    status,
    rendererGone() {
      context = null;
      generation += 1;
      cancelPending('NOT_READY');
    },
    async close() {
      context = null;
      generation += 1;
      cancelPending('CANCELLED');
      await server.disable();
    },
  };
}
