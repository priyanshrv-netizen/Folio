import type { Styles, McpLayout } from '../../src/mcp/types';
import type { NodeType } from '../../src/types';
export function normalizeColor(input: unknown): string;
export function cssPixels(input: unknown): number;
export function cssToStyles(
  input: Record<string, string | number>,
  type?: NodeType,
  currentLayout?: McpLayout,
): Styles;
