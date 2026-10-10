import type { McpErrorCode, McpResult } from '../../src/mcp/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export const MAX_REQUEST_BYTES: number;
export const MAX_RESULT_BYTES: number;
export const REQUEST_TIMEOUT_MS: number;
export const ERROR_MESSAGES: Readonly<Record<McpErrorCode, string>>;
export class McpBridgeError extends Error {
  constructor(code: string);
  code: McpErrorCode;
}
export function createLocalMcpServer(options: {
  dispatch(name: string, args: unknown, options: { signal: AbortSignal }): Promise<McpResult>;
  requestTimeoutMs?: number;
}): {
  status(): { enabled: boolean; endpoint: string | null; port: number | null };
  enable(options?: {
    port?: number;
  }): Promise<{ enabled: boolean; endpoint: string | null; port: number | null }>;
  disable(): Promise<{ enabled: boolean; endpoint: string | null; port: number | null }>;
};
export function createSdkServer(
  dispatch: (
    name: string,
    args: unknown,
    options: { signal: AbortSignal },
  ) => Promise<McpResult | CallToolResult>,
  signal?: AbortSignal,
  options?: { protocolResults?: boolean },
): McpServer;
export function isAllowedRequest(
  request: import('node:http').IncomingMessage,
  port: number,
): boolean;
