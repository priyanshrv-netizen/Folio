import type { McpStatus } from '../../src/mcp/types';
export function registerMcpBridge(
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
    ) => unknown;
  },
  getWindow: () => unknown,
  entryUrl: string,
  options?: { commandTimeoutMs?: number; serverOptions?: Record<string, unknown> },
): {
  status(): McpStatus;
  rendererGone(): void;
  close(): Promise<void>;
};
