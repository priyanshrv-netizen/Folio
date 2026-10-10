import type { DesignNode, FrameLayout } from '../../src/types';
export function validateLayout(input: unknown, path?: string): FrameLayout;
export function reflowNodes(nodes: DesignNode[]): DesignNode[];
