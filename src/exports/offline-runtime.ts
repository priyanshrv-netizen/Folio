import { validateShaderConfig } from '../../desktop/persistence/validation.mjs';
import {
  mountPaperShader,
  shaderSpeed,
  waitForShaderPaint,
  type PaperShaderRenderer,
} from '../shaders/runtime';
import type { ShaderConfig } from '../types';

async function start() {
  const data = document.getElementById('folio-animation-data');
  if (!data?.textContent) return;
  const fills = JSON.parse(data.textContent) as {
    id: string;
    config: ShaderConfig;
    width: number;
    height: number;
    frame: number;
  }[];
  if (!Array.isArray(fills) || fills.length > 8) return;
  const controller = new AbortController();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const live: {
    renderer: PaperShaderRenderer;
    config: ShaderConfig;
    host: HTMLDivElement;
    fallback: HTMLImageElement;
  }[] = [];
  const updateMotion = () => {
    for (const entry of live) {
      entry.renderer.update(entry.config, motion.matches);
      entry.host.dataset.shaderMotion =
        shaderSpeed(entry.config, motion.matches) === 0 ? 'paused' : 'playing';
    }
  };
  const dispose = () => {
    controller.abort();
    motion.removeEventListener('change', updateMotion);
    for (const entry of live) {
      entry.renderer.dispose();
      entry.host.remove();
      entry.fallback.hidden = false;
    }
    live.length = 0;
    document.documentElement.dataset.folioAnimation = 'snapshot';
  };
  window.addEventListener('pagehide', dispose, { once: true });
  motion.addEventListener('change', updateMotion);
  for (const fill of fills) {
    if (controller.signal.aborted) break;
    const node = [...document.querySelectorAll<HTMLElement>('[data-node-id]')].find(
      (candidate) => candidate.dataset.nodeId === fill.id,
    );
    const fallback = node?.querySelector<HTMLImageElement>(
      ':scope > img[data-shader-export="snapshot"]',
    );
    if (!fallback) continue;
    const host = document.createElement('div');
    host.dataset.shaderExport = 'live';
    host.dataset.shaderStatus = 'loading';
    host.style.cssText = `position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:${fallback.style.borderRadius};`;
    host.setAttribute('aria-hidden', 'true');
    fallback.after(host);
    let renderer: PaperShaderRenderer | undefined;
    try {
      const config = validateShaderConfig(fill.config);
      if (!Number.isFinite(fill.frame) || fill.frame < 0) throw new Error('Invalid shader frame.');
      renderer = await mountPaperShader(
        host,
        config,
        fill.width,
        fill.height,
        controller.signal,
        fill.frame,
      );
      await waitForShaderPaint(controller.signal);
      renderer.snapshot();
      const entry = { renderer, config, host, fallback };
      live.push(entry);
      renderer.mount.canvasElement.addEventListener(
        'webglcontextlost',
        () => {
          const index = live.indexOf(entry);
          if (index >= 0) live.splice(index, 1);
          renderer?.dispose();
          host.remove();
          fallback.hidden = false;
          fallback.dataset.shaderFallback = 'webgl-unavailable';
        },
        { once: true },
      );
      host.dataset.shaderStatus = 'ready';
      fallback.hidden = true;
      updateMotion();
    } catch {
      renderer?.dispose();
      host.remove();
      fallback.hidden = false;
      fallback.dataset.shaderFallback = 'webgl-unavailable';
    }
  }
  document.documentElement.dataset.folioAnimation = live.length ? 'ready' : 'snapshot';
}

void start().catch(() => {
  document.documentElement.dataset.folioAnimation = 'snapshot';
});
