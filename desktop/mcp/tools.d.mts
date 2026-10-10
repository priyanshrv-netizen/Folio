import type { ZodType } from 'zod';
import type { McpCommand } from '../../src/mcp/types';
export const TOOL_DEFINITIONS: ReadonlyArray<{
  name: McpCommand['name'];
  description: string;
  schema: ZodType;
  mutating: boolean;
}>;
export function parseTool(name: string, args: unknown): McpCommand;
export const HELPER_DEFINITIONS: typeof TOOL_DEFINITIONS;
export const ALL_TOOL_DEFINITIONS: typeof TOOL_DEFINITIONS;
