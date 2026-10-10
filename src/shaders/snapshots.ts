import { validatePage, validateShaderSnapshot } from '../../desktop/persistence/validation.mjs';
import type { DesignPage, ShaderConfig, ShaderSnapshots } from '../types';
import {
  mountPaperShader,
  shaderConfigKey,
  waitForShaderPaint,
  type PaperShaderRenderer,
} from './runtime';

interface LiveShader {
  renderer: PaperShaderRenderer;
  configKey: string;
  width: number;
  height: number;
}

export const liveShaders = new Map<string, LiveShader>();
const previews = new Map<string, Promise<string>>();
let renderQueue: Promise<unknown> = Promise.resolve();

export function renderShaderSnapshot(
  config: ShaderConfig,
  width: number,
  height: number,
): Promise<string> {
  const task = renderQueue
    .catch(() => {})
    .then(async () => {
      const host = document.createElement('div');
      Object.assign(host.style, {
        position: 'fixed',
        left: '-200000px',
        top: '0',
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
      });
      host.setAttribute('aria-hidden', 'true');
      document.body.append(host);
      const controller = new AbortController();
      let renderer: PaperShaderRenderer | undefined;
      try {
        renderer = await mountPaperShader(host, config, width, height, controller.signal);
        await waitForShaderPaint(controller.signal);
        return renderer.snapshot();
      } finally {
        controller.abort();
        renderer?.dispose();
        host.remove();
      }
    });
  renderQueue = task;
  return task;
}

export function renderShaderPreview(
  config: ShaderConfig,
  width: number,
  height: number,
): Promise<string> {
  const ratio = Math.min(1, 320 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  const key = `${shaderConfigKey(config)}:${w}:${h}`;
  const cached = previews.get(key);
  if (cached) return cached;
  const result = renderShaderSnapshot(config, w, h).catch((cause) => {
    previews.delete(key);
    throw cause;
  });
  previews.set(key, result);
  if (previews.size > 48) previews.delete(previews.keys().next().value!);
  return result;
}

export async function prepareShaderSnapshots(input: DesignPage): Promise<ShaderSnapshots> {
  const page = validatePage(input);
  const nodes = new Map(page.nodes.map((node) => [node.id, node]));
  const snapshots: Record<string, string> = Object.create(null);
  const budget = { imageBytes: 0 };
  for (const node of page.nodes) {
    if (!node.shader) continue;
    let ancestor: typeof node | undefined = node;
    let visible = true;
    while (ancestor) {
      if (!ancestor.visible || ancestor.opacity === 0) {
        visible = false;
        break;
      }
      ancestor = ancestor.parentId === null ? undefined : nodes.get(ancestor.parentId);
    }
    if (!visible) continue;
    const live = liveShaders.get(node.id);
    try {
      const dataUrl =
        live &&
        live.configKey === shaderConfigKey(node.shader) &&
        live.width === node.width &&
        live.height === node.height
          ? live.renderer.snapshot()
          : await renderShaderSnapshot(node.shader, node.width, node.height);
      snapshots[node.id] = validateShaderSnapshot(
        dataUrl,
        `shader snapshot for ${node.id}`,
        budget,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not render this shader.';
      throw new Error(`Could not export the Paper shader on “${node.name}”: ${message}`);
    }
  }
  return snapshots;
}
