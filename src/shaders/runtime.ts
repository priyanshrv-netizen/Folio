import { ShaderMount } from '@paper-design/shaders';
import {
  validateShaderConfig,
  validateShaderSnapshot,
} from '../../desktop/persistence/validation.mjs';
import type { ShaderConfig } from '../types';
import { shaderDefinition } from './schema.mjs';
import { getPaperShaderSpec } from './spec';
import { paperShaderTextures } from './sources';

export { getPaperShaderSpec } from './spec';
export type { PaperShaderSpec } from './spec';

export const SHADER_INITIAL_FRAME = 8_000;
export const SHADER_MAX_PIXELS = 2_097_152;
export const SHADER_MAX_DIMENSION = 2_048;


export function shaderPixelBudget(width: number, height: number): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    Math.max(width / height, height / width) > SHADER_MAX_DIMENSION
  ) {
    throw new Error('Paper shader dimensions must have an aspect ratio of at most 2048:1.');
  }
  const ratio = Math.min(1.5, SHADER_MAX_DIMENSION / width, SHADER_MAX_DIMENSION / height);
  return Math.max(1, Math.floor(Math.min(SHADER_MAX_PIXELS, width * height * ratio * ratio)));
}

export function shaderSpeed(config: ShaderConfig, reducedMotion: boolean): number {
  return reducedMotion || config.paused || !shaderDefinition(config.kind)?.animated ? 0 : config.speed;
}

export function shaderConfigKey(config: ShaderConfig): string {
  return JSON.stringify(validateShaderConfig(config));
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgl2');
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.remove();
}

export interface PaperShaderRenderer {
  mount: ShaderMount;
  update(config: ShaderConfig, reducedMotion: boolean): void;
  resize(width: number, height: number): void;
  snapshot(): string;
  dispose(): void;
}

export async function mountPaperShader(
  host: HTMLDivElement,
  input: ShaderConfig,
  width: number,
  height: number,
  signal: AbortSignal,
  frame = SHADER_INITIAL_FRAME,
): Promise<PaperShaderRenderer> {
  signal.throwIfAborted();
  const config = validateShaderConfig(input);
  const budget = shaderPixelBudget(width, height);
  const spec = getPaperShaderSpec(config);
  const images = await paperShaderTextures(config, spec);
  signal.throwIfAborted();
  let mount: ShaderMount;
  try {
    mount = new ShaderMount(
      host,
      spec.fragmentShader,
      { ...spec.uniforms, ...images },
      {
        alpha: true,
        antialias: false,
        preserveDrawingBuffer: true,
        powerPreference: 'low-power',
      },
      0,
      frame,
      1,
      budget,
      spec.mipmaps,
    );
  } catch (cause) {
    host.querySelectorAll('canvas').forEach(releaseCanvas);
    const message = cause instanceof Error ? cause.message : 'Could not initialize the shader.';
    throw new Error(`Paper shader unavailable. WebGL2 is required. ${message}`);
  }
  mount.canvasElement.style.zIndex = '0';
  mount.canvasElement.style.pointerEvents = 'none';
  let disposed = false;
  return {
    mount,
    update(next, reducedMotion) {
      if (disposed) return;
      const safe = validateShaderConfig(next);
      if (safe.kind !== config.kind)
        throw new Error('A different shader preset needs a new mount.');
      if (safe.source !== config.source)
        throw new Error('A different shader image needs a new mount.');
      mount.setUniforms({ ...getPaperShaderSpec(safe).uniforms, ...images });
      mount.setSpeed(shaderSpeed(safe, reducedMotion));
    },
    resize(nextWidth, nextHeight) {
      if (!disposed) mount.setMaxPixelCount(shaderPixelBudget(nextWidth, nextHeight));
    },
    snapshot() {
      if (disposed) throw new Error('The Paper shader is no longer mounted.');
      const canvas = mount.canvasElement;
      if (!canvas.width || !canvas.height || canvas.getContext('webgl2')?.isContextLost())
        throw new Error('The Paper shader has not rendered or its WebGL2 context was lost.');
      mount.setFrame(mount.getCurrentFrame());
      return validateShaderSnapshot(canvas.toDataURL('image/png'));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const canvas = mount.canvasElement;
      mount.dispose();
      releaseCanvas(canvas);
    },
  };
}

export function waitForShaderPaint(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let first = 0;
    let second = 0;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error('Paper shader rendering was cancelled.'));
    const timer = setTimeout(
      () =>
        finish(new Error('Paper shader rendering timed out. Keep the editor visible and retry.')),
      5_000,
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => finish());
      });
  });
}
