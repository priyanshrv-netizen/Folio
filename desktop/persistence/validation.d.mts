import type {
  DesignDocument,
  DesignNode,
  DesignPage,
  DocumentSummary,
  ShaderConfig,
  BlendMode,
} from '../../src/types';

type Budget = { nodes: number; text: number; imageBytes: number };
export const MAX_DOCUMENT_BYTES: number;
export const MAX_IMAGE_BYTES: number;
export const MAX_DEPTH: number;
export const BLEND_MODES: readonly BlendMode[];
export function validateId(input: unknown, path?: string): string;
export function validateShaderConfig(
  input: unknown,
  path?: string,
  budget?: { imageBytes: number },
): ShaderConfig;
export function validateShaderSource(
  input: unknown,
  path?: string,
  budget?: { imageBytes: number },
): string;
export function validateShaderSnapshot(
  input: unknown,
  path?: string,
  budget?: { imageBytes: number },
): string;
export function validateDocument(input: unknown): DesignDocument;
export function validateNode(input: unknown, path?: string, budget?: Budget): DesignNode;
export function validatePage(
  input: unknown,
  path?: string,
  ids?: Set<string>,
  budget?: Budget,
): DesignPage;
export function documentSummary(document: DesignDocument): DocumentSummary;
export function rasterMime(bytes: ArrayLike<number>): string;
export function validateBase64(encoded: unknown, maxBytes?: number): number;
