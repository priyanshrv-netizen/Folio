import { exportPageSvg } from '../model';
import {
  mountPaperShader,
  shaderSpeed,
  SHADER_INITIAL_FRAME,
  waitForShaderPaint,
  type PaperShaderRenderer,
} from '../shaders/runtime';
import type { DesignPage } from '../types';
import { exportScene, pausedShader, videoDimensions, videoOptions } from './scene';
import { finalizeWebm } from './webm-container';

export interface WebmExportOptions {
  duration: number;
  fps: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
let exporting = false;

function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', abort);
        resolve();
      },
      Math.max(0, milliseconds),
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function exportWebm(input: DesignPage, options: WebmExportOptions): Promise<Blob> {
  options.signal?.throwIfAborted();
  const { duration, fps, frames } = videoOptions(options.duration, options.fps);
  const { page, shaders } = exportScene(input);
  if (exporting) throw new Error('Another video export is already running.');
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream)
    throw new Error(
      'WebM export requires a browser with MediaRecorder and canvas capture support.',
    );
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType) throw new Error('This browser cannot encode WebM. Use Animated HTML instead.');
  exporting = true;
  const controller = new AbortController();
  const { signal } = controller;
  const abort = () => controller.abort(new DOMException('Video export cancelled.', 'AbortError'));
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error('Video export timed out. Keep Folio visible, reduce the page size, and retry.'),
      ),
    90_000,
  );
  const host = document.createElement('div');
  host.dataset.folioExportHost = 'webm';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-200000px;top:0;pointer-events:none;';
  document.body.append(host);
  const canvas = document.createElement('canvas');
  const mounts: {
    renderer: PaperShaderRenderer;
    id: string;
    speed: number;
    initialFrame: number;
  }[] = [];
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  let stopped: Promise<void> | undefined;
  const chunks: Blob[] = [];
  try {
    options.onProgress?.(0);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const snapshots: Record<string, string> = Object.create(null);
    for (const node of shaders) {
      signal.throwIfAborted();
      const element = document.createElement('div');
      element.style.cssText = `position:relative;width:${node.width}px;height:${node.height}px;`;
      host.append(element);
      const initialFrame = pausedShader(node)?.mount.getCurrentFrame() ?? SHADER_INITIAL_FRAME;
      const renderer = await abortable(
        mountPaperShader(element, node.shader!, node.width, node.height, signal, initialFrame),
        signal,
      );
      mounts.push({
        renderer,
        id: node.id,
        speed: shaderSpeed(node.shader!, reducedMotion),
        initialFrame,
      });
      renderer.mount.canvasElement.addEventListener(
        'webglcontextlost',
        () => {
          controller.abort(
            new Error(
              'A shader WebGL2 context was lost during export. Reduce the number of shader fills and retry.',
            ),
          );
        },
        { once: true, signal },
      );
      await waitForShaderPaint(signal);
      snapshots[node.id] = renderer.snapshot();
    }
    const svg = new DOMParser().parseFromString(
      exportPageSvg(page, snapshots),
      'image/svg+xml',
    ).documentElement;
    const size = videoDimensions(
      Number(svg.getAttribute('width')),
      Number(svg.getAttribute('height')),
    );
    canvas.width = size.width;
    canvas.height = size.height;
    svg.setAttribute('width', String(size.width));
    svg.setAttribute('height', String(size.height));
    const { default: bundle } = await abortable(import('./bundled-runtime'), signal);
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = bundle.fonts;
    svg.prepend(style);
    const images = new Map(
      [...svg.querySelectorAll<SVGImageElement>('image[data-shader-export="snapshot"]')].map(
        (image) => [image.closest('[data-node-id]')!.getAttribute('data-node-id')!, image],
      ),
    );
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas compositing is unavailable in this browser.');
    const paint = async (frame: number) => {
      signal.throwIfAborted();
      for (const entry of mounts) {
        if (frame !== 0 && entry.speed === 0) continue;
        entry.renderer.mount.setFrame(entry.initialFrame + ((frame * 1000) / fps) * entry.speed);
        images.get(entry.id)!.setAttribute('href', entry.renderer.snapshot());
      }
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }),
      );
      const image = new Image();
      try {
        image.src = url;
        await abortable(image.decode(), signal);
        signal.throwIfAborted();
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      } finally {
        image.src = '';
        URL.revokeObjectURL(url);
      }
    };
    await paint(0);
    signal.throwIfAborted();
    stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    if (!track || typeof track.requestFrame !== 'function')
      throw new Error(
        'This browser cannot capture individual video frames. Use Animated HTML instead.',
      );
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    let bytes = 0;
    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data.size) return;
      bytes += event.data.size;
      if (bytes > MAX_VIDEO_BYTES)
        controller.abort(new Error('The recorded video exceeds the 64 MiB export limit.'));
      else chunks.push(event.data);
    });
    recorder.addEventListener('error', () =>
      controller.abort(
        new Error('The browser failed to encode this video. Try a smaller page or Animated HTML.'),
      ),
    );
    stopped = new Promise<void>((resolve) =>
      recorder!.addEventListener('stop', () => resolve(), { once: true }),
    );
    const started = new Promise<void>((resolve) =>
      recorder!.addEventListener('start', () => resolve(), { once: true }),
    );
    recorder.start(250);
    track.requestFrame();
    await abortable(started, signal);
    const start = performance.now();
    const end = start + duration * 1000;
    for (let frame = 1; frame < frames; frame += 1) {
      await delay(start + (frame * 1000) / fps - performance.now(), signal);
      await paint(frame);
      signal.throwIfAborted();
      track.requestFrame();
      options.onProgress?.(Math.min(0.99, frame / frames));
    }
    await delay(Math.max(1000 / fps, end - performance.now()), signal);
    recorder.stop();
    await abortable(stopped, signal);
    signal.throwIfAborted();
    if (!chunks.length) throw new Error('The video recorder returned an empty video.');
    const blob = await abortable(
      finalizeWebm(new Blob(chunks, { type: 'video/webm' }), duration),
      signal,
    );
    signal.throwIfAborted();
    options.onProgress?.(1);
    return blob;
  } catch (error) {
    throw signal.aborted ? signal.reason : error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
    controller.abort();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    if (stopped)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        void stopped!.then(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    for (const entry of mounts) entry.renderer.dispose();
    host.remove();
    canvas.width = canvas.height = 1;
    chunks.length = 0;
    exporting = false;
  }
}
