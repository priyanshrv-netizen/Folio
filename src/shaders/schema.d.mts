import type { ShaderKind } from '../types';

export interface ShaderParameter {
  type: 'number' | 'boolean';
  label: string;
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: number; label: string }[];
}

export interface ShaderDefinition {
  category: 'effect' | 'image-filter' | 'logo';
  animated: boolean;
  maxColors: number;
  detailLabel: string;
  supportsImage: boolean;
  parameters: Record<string, ShaderParameter>;
  palette?: 'all' | 'none';
  colorLabels?: string[];
}

export const SHADER_DEFINITIONS: Record<Exclude<ShaderKind, 'smoke-ring'>, ShaderDefinition>;
export function shaderDefinition(kind: string): ShaderDefinition | undefined;