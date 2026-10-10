import type { McpErrorCode } from './types';

export class CommandError extends Error {
  constructor(public readonly code: McpErrorCode) {
    super(code);
  }
}
