import { MAX_DOCUMENT_BYTES, validatePage } from '../../desktop/persistence/validation.mjs';
import { shaderConfigKey, shaderPixelBudget, shaderSpeed } from '../shaders/runtime';
import { liveShaders } from '../shaders/snapshots';
import type { DesignNode, DesignPage } from '../types';

export const MAX_EXPORT_SHADERS = 8;
export const MAX_EXPORT_SHADER_PIXELS = 8_388_608;
export const MAX_VIDEO_PIXELS = 2_073_600;
export const MAX_VIDEO_DIMENSION = 1920;

export function pausedShader(node: DesignNode) {
  if (!node.shader || shaderSpeed(node.shader, false) !== 0) return;
  const live = liveShaders.get(node.id);
  if (
    live?.configKey === shaderConfigKey(node.shader) &&
    live.width === node.width &&
    live.height === node.height
  )
    return live.renderer;
}

export function exportScene(input: DesignPage) {
  const page = validatePage(input);
  if (new TextEncoder().encode(JSON.stringify(page)).byteLength > MAX_DOCUMENT_BYTES)
    throw new Error('The export page exceeds the 32 MiB document limit.');
  const children = new Map<string | null, DesignNode[]>();
  for (const node of page.nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const shaders: DesignNode[] = [];
  const visit = (parent: string | null) => {
    for (const node of children.get(parent) ?? []) {
      if (!node.visible || node.opacity === 0) continue;
      if (node.shader) shaders.push(node);
      visit(node.id);
    }
  };
  visit(null);
  if (shaders.length > MAX_EXPORT_SHADERS)
    throw new Error(
      `Animated exports support at most ${MAX_EXPORT_SHADERS} visible shader fills. Export a smaller page or use a static export.`,
    );
  if (
    shaders.reduce((sum, node) => sum + shaderPixelBudget(node.width, node.height), 0) >
    MAX_EXPORT_SHADER_PIXELS
  )
    throw new Error(
      'The shader fills exceed the animated export pixel budget. Reduce their dimensions or export a smaller page.',
    );
  return { page, shaders };
}

export function videoOptions(duration: number, fps: number) {
  if (!Number.isFinite(duration) || duration < 1 || duration > 15)
    throw new Error('Video duration must be between 1 and 15 seconds.');
  if (![12, 24, 30].includes(fps)) throw new Error('Video frame rate must be 12, 24, or 30 fps.');
  return { duration, fps, frames: Math.ceil(duration * fps) };
}

export function videoDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new Error('The page has invalid export dimensions.');
  const scale = Math.min(
    1,
    MAX_VIDEO_DIMENSION / Math.max(width, height),
    Math.sqrt(MAX_VIDEO_PIXELS / (width * height)),
  );
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

export function inertJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
