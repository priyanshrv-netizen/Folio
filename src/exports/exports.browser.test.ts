import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SHADER_CATALOG } from '../shaders/presets';
import { folioExportRuntime } from './vite-plugin.mjs';

type Harness = typeof import('./index') &
  typeof import('../model') &
  typeof import('../shaders/presets') &
  typeof import('../shaders/runtime') &
  typeof import('../shaders/snapshots');
declare global {
  interface Window {
    folioExportTest: Harness;
  }
}

let server: ViteDevServer;
let browser: Browser;
let editor: Page;
let directory: string;
let fileIndex = 0;
const errors: string[] = [];
const externalRequests: string[] = [];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'folio-exports-'));
  server = await createServer({
    configFile: false,
    appType: 'custom',
    plugins: [folioExportRuntime()],
    cacheDir: 'node_modules/.vite-export-tests',
    optimizeDeps: { entries: ['src/exports/index.ts'] },
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  server.middlewares.use((request, response, next) => {
    if (request.url !== '/__folio_export_test') return next();
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><html><head><title>Folio export tests</title></head><body><div id="app-sentinel" style="position:fixed;inset:0;background:#ff00ff">NOT ARTWORK</div></body></html>',
    );
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  editor = await browser.newPage();
  editor.on('pageerror', (error) => errors.push(error.message));
  await editor.goto(`${server.resolvedUrls!.local[0]}__folio_export_test`);
  await editor.addScriptTag({
    type: 'module',
    content: `
    import * as exports from '/src/exports/index.ts';
    import * as model from '/src/model.ts';
    import * as presets from '/src/shaders/presets.ts';
    import * as runtime from '/src/shaders/runtime.ts';
    import * as snapshots from '/src/shaders/snapshots.ts';
    window.folioExportTest = { ...exports, ...model, ...presets, ...runtime, ...snapshots };
  `,
  });
  await editor.waitForFunction(() => !!window.folioExportTest);
}, 45_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function openOffline(
  html: string,
  options: { reducedMotion?: boolean; webgl?: boolean } = {},
) {
  const path = join(directory, `export-${fileIndex++}.html`);
  await writeFile(path, html);
  const context = await browser.newContext({
    offline: true,
    reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
    viewport: { width: 800, height: 600 },
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
  });
  if (options.webgl === false)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        return type === 'webgl2' ? null : Reflect.apply(original, this, [type, ...args]);
      } as typeof original;
    });
  await page.goto(pathToFileURL(path).href);
  await page.waitForFunction(() => !!document.documentElement.dataset.folioAnimation);
  return { context, page, path };
}

async function sample(page: Page) {
  return page
    .locator('[data-shader-export="live"] canvas')
    .evaluateAll((canvases) => canvases.map((canvas) => (canvas as HTMLCanvasElement).toDataURL()));
}

describe('self-contained offline animated HTML', () => {
  it('preserves the editor’s already-paused frame without changing its live renderer', async () => {
    const result = await editor.evaluate(async () => {
      const runtime = window.folioExportTest;
      const { liveShaders } = runtime;
      const { createNode, createShaderConfig, exportAnimatedHtml, exportWebm } =
        window.folioExportTest;
      const config = { ...createShaderConfig('mesh-gradient'), paused: true };
      const node = createNode('rectangle', {
        id: 'live-paused',
        width: 160,
        height: 120,
        shader: config,
      });
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-1000px;width:160px;height:120px';
      document.body.append(host);
      const controller = new AbortController();
      const renderer = await runtime.mountPaperShader(
        host,
        config,
        160,
        120,
        controller.signal,
        18500,
      );
      try {
        await runtime.waitForShaderPaint(controller.signal);
        liveShaders.set(node.id, {
          renderer,
          configKey: runtime.shaderConfigKey(config),
          width: 160,
          height: 120,
        });
        const snapshot = renderer.snapshot();
        const input = { id: 'paused-page', name: 'Paused frame', nodes: [node] };
        const html = await exportAnimatedHtml(input);
        const videoBlob = await exportWebm(input, { duration: 1, fps: 12 });
        const video = document.createElement('video');
        const url = URL.createObjectURL(videoBlob);
        const loaded = new Promise<void>((resolve) => (video.onloadedmetadata = () => resolve()));
        video.src = url;
        document.body.append(video);
        try {
          await loaded;
          const seeked = new Promise<void>((resolve) => (video.onseeked = () => resolve()));
          video.currentTime = 0.5;
          await seeked;
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = 120;
          const context = canvas.getContext('2d')!;
          context.drawImage(video, 0, 0);
          const pixels = context.getImageData(0, 0, 160, 120).data;
          const image = new Image();
          image.src = snapshot;
          await image.decode();
          context.drawImage(image, 0, 0);
          const expected = context.getImageData(0, 0, 160, 120).data;
          let difference = 0;
          for (let index = 0; index < pixels.length; index += 1)
            difference += Math.abs(pixels[index] - expected[index]);
          return {
            html,
            snapshot,
            frame: renderer.mount.getCurrentFrame(),
            difference: difference / pixels.length,
          };
        } finally {
          video.removeAttribute('src');
          video.load();
          video.remove();
          URL.revokeObjectURL(url);
        }
      } finally {
        liveShaders.delete(node.id);
        controller.abort();
        renderer.dispose();
        host.remove();
      }
    });
    expect(result.frame).toBe(18500);
    expect(result.difference).toBeLessThan(3);
    const { context, page } = await openOffline(result.html);
    try {
      expect((await sample(page))[0]).toBe(result.snapshot);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('renders changed pixels, preserves paused and zero-speed fills, and reacts to reduced motion', async () => {
    const html = await editor.evaluate(async () => {
      const { createNode, createShaderConfig, exportAnimatedHtml } = window.folioExportTest;
      return exportAnimatedHtml({
        id: 'page',
        name: 'Animation proof',
        nodes: [
          createNode('rectangle', {
            id: 'moving',
            width: 220,
            height: 160,
            radius: 20,
            shader: createShaderConfig('mesh-gradient'),
          }),
          createNode('ellipse', {
            id: 'paused',
            x: 230,
            width: 220,
            height: 160,
            shader: { ...createShaderConfig('mesh-gradient'), paused: true },
          }),
          createNode('rectangle', {
            id: 'zero',
            x: 460,
            width: 220,
            height: 160,
            shader: { ...createShaderConfig('mesh-gradient'), speed: 0 },
          }),
        ],
      });
    });
    const { context, page, path } = await openOffline(html);
    try {
      expect(await page.locator('[data-shader-status="ready"]').count()).toBe(3);
      expect(await page.locator('[data-shader-motion="playing"]').count()).toBe(1);
      const first = await sample(page);
      await page.waitForTimeout(450);
      const later = await sample(page);
      expect(later[0]).not.toBe(first[0]);
      expect(later[1]).toBe(first[1]);
      expect(later[2]).toBe(first[2]);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(
        () => document.querySelectorAll('[data-shader-motion="playing"]').length === 0,
      );
      const still = await sample(page);
      await page.waitForTimeout(250);
      expect(await sample(page)).toEqual(still);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForFunction(
        () => document.querySelectorAll('[data-shader-motion="playing"]').length === 1,
      );
      await page.waitForTimeout(150);
      expect((await sample(page))[0]).not.toBe(still[0]);
      if (process.env.FOLIO_EXPORT_PROOF_PATH) {
        await page.screenshot({ path: process.env.FOLIO_EXPORT_PROOF_PATH });
        await writeFile(`${process.env.FOLIO_EXPORT_PROOF_PATH}.html`, html);
      }
      expect(path.startsWith(directory)).toBe(true);
    } finally {
      await context.close();
    }
  }, 45_000);

  it.each(['paused', 'reduced-motion', 'zero-speed'] as const)(
    'keeps %s shader pixels stationary in decoded video',
    async (mode) => {
      await editor.emulateMedia({
        reducedMotion: mode === 'reduced-motion' ? 'reduce' : 'no-preference',
      });
      try {
        const result = await editor.evaluate(async (mode) => {
          const { createNode, createShaderConfig, exportWebm } = window.folioExportTest;
          const config = createShaderConfig('mesh-gradient');
          if (mode === 'paused') config.paused = true;
          if (mode === 'zero-speed') config.speed = 0;
          const blob = await exportWebm(
            {
              id: 'stationary',
              name: mode,
              nodes: [createNode('ellipse', { width: 160, height: 120, shader: config })],
            },
            { duration: 1, fps: 24 },
          );
          const video = document.createElement('video');
          video.muted = true;
          const url = URL.createObjectURL(blob);
          const loaded = new Promise<void>((resolve) => (video.onloadedmetadata = () => resolve()));
          video.src = url;
          document.body.append(video);
          try {
            await loaded;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d')!;
            const read = async (time: number) => {
              const seeked = new Promise<void>((resolve) => (video.onseeked = () => resolve()));
              video.currentTime = time;
              await seeked;
              context.drawImage(video, 0, 0);
              return [...context.getImageData(0, 0, canvas.width, canvas.height).data];
            };
            const first = await read(0.1);
            const later = await read(0.8);
            let difference = 0;
            for (let index = 0; index < first.length; index += 1)
              difference += Math.abs(first[index] - later[index]);
            return {
              difference: difference / first.length,
              duration: video.duration,
              corner: later.slice(0, 4),
            };
          } finally {
            video.removeAttribute('src');
            video.load();
            video.remove();
            URL.revokeObjectURL(url);
          }
        }, mode);
        expect(result.duration).toBeCloseTo(1, 2);
        expect(result.difference).toBeLessThan(1);
        expect(result.corner.slice(0, 3)).toEqual([255, 255, 255]);
      } finally {
        await editor.emulateMedia({ reducedMotion: 'no-preference' });
      }
    },
    30_000,
  );

  it('honors the UI maximum duration and frame rate across recorder clusters', async () => {
    const result = await editor.evaluate(async () => {
      const { createNode, exportWebm } = window.folioExportTest;
      const blob = await exportWebm(
        {
          id: 'maximum',
          name: 'Maximum',
          nodes: [createNode('rectangle', { width: 80, height: 60 })],
        },
        { duration: 15, fps: 30 },
      );
      const video = document.createElement('video');
      const loaded = new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Could not decode the long video.'));
      });
      const url = URL.createObjectURL(blob);
      video.src = url;
      try {
        await loaded;
        return { duration: video.duration, size: blob.size };
      } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      }
    });
    expect(result.duration).toBeCloseTo(15, 2);
    expect(result.size).toBeGreaterThan(1000);
  }, 35_000);

  it.each(SHADER_CATALOG)(
    'bundles and renders the genuine $id shader offline',
    async ({ config, animated }) => {
      const html = await editor.evaluate(async (config) => {
        const { createNode, exportAnimatedHtml } = window.folioExportTest;
        return exportAnimatedHtml({
          id: 'catalog',
          name: config.kind,
          nodes: [createNode('rectangle', { width: 160, height: 120, shader: config })],
        });
      }, config);
      const { context, page } = await openOffline(html);
      try {
        expect(await page.locator('[data-shader-status="ready"]').count()).toBe(1);
        const result = await page
          .locator('[data-shader-export="live"] canvas')
          .evaluate((element) => {
            const canvas = element as HTMLCanvasElement;
            const gl = canvas.getContext('webgl2')!;
            const values = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, values);
            const colors = new Set<string>();
            for (let index = 0; index < values.length; index += 4)
              colors.add(
                `${values[index]},${values[index + 1]},${values[index + 2]},${values[index + 3]}`,
              );
            return {
              colors: colors.size,
              error: gl.getError(),
              mode: canvas.parentElement!.dataset.shaderMotion,
            };
          });
        expect(result.colors).toBeGreaterThanOrEqual(2);
        expect(result.error).toBe(0);
        expect(result.mode).toBe(
          animated && config.speed > 0 && !config.paused ? 'playing' : 'paused',
        );
        expect(html).toContain('data:font/woff2;base64,');
        expect(html).toContain('Apache License');
        expect(html).toContain('SIL OPEN FONT LICENSE');
      } finally {
        await context.close();
      }
    },
    30_000,
  );

  it('keeps original nesting, transforms, rounded shader clipping, order, text, and embedded assets', async () => {
    const html = await editor.evaluate(async () => {
      const { createNode, createShaderConfig, exportAnimatedHtml } = window.folioExportTest;
      return exportAnimatedHtml({
        id: 'geometry',
        name: '</title><script>window.hacked=true</script>',
        nodes: [
          createNode('frame', {
            id: 'parent',
            x: 40,
            y: 50,
            width: 280,
            height: 210,
            rotation: 15,
            opacity: 0.8,
            fill: '#16324a',
          }),
          createNode('ellipse', {
            id: 'child',
            parentId: 'parent',
            x: 15,
            y: 20,
            width: 140,
            height: 100,
            shader: { ...createShaderConfig('mesh-gradient'), paused: true },
          }),
          createNode('text', {
            id: 'text',
            parentId: 'parent',
            x: 12,
            y: 120,
            width: 230,
            text: '</script><img src="https://bad.test/" onerror="window.hacked=true">',
            fontFamily: 'Inter',
          }),
        ],
      });
    });
    const { context, page } = await openOffline(html);
    try {
      const result = await page.evaluate(() => {
        const parent = document.querySelector<HTMLElement>('[data-node-id="parent"]')!;
        const child = document.querySelector<HTMLElement>('[data-node-id="child"]')!;
        const clip = child.querySelector<HTMLElement>('[data-shader-export="live"]')!;
        return {
          nested: child.parentElement === parent,
          order: [...parent.querySelectorAll(':scope > [data-node-id]')].map((node) =>
            node.getAttribute('data-node-id'),
          ),
          opacity: parent.style.opacity,
          rotation: parent.style.transform,
          radius: clip.style.borderRadius,
          overflow: clip.style.overflow,
          text: parent.querySelector('[data-node-id="text"]')!.textContent,
          scriptCount: document.scripts.length,
          hacked: 'hacked' in window,
        };
      });
      expect(result).toMatchObject({
        nested: true,
        order: ['child', 'text'],
        opacity: '0.8',
        rotation: 'rotate(15deg)',
        radius: '50%',
        overflow: 'hidden',
        scriptCount: 2,
        hacked: false,
      });
      expect(result.text).toContain('<img src="https://bad.test/"');
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.fonts.check('400 16px Inter'))).toBe(true);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('shows actual snapshot pixels without WebGL2 and starts stationary under reduced motion', async () => {
    const html = await editor.evaluate(async () => {
      const { createNode, createShaderConfig, exportAnimatedHtml } = window.folioExportTest;
      return exportAnimatedHtml({
        id: 'fallback',
        name: 'Fallback proof',
        nodes: [
          createNode('rectangle', { width: 220, height: 160, shader: createShaderConfig('water') }),
        ],
      });
    });
    const fallback = await openOffline(html, { webgl: false });
    try {
      expect(await fallback.page.locator('canvas').count()).toBe(0);
      const result = await fallback.page
        .locator('img[data-shader-fallback="webgl-unavailable"]')
        .evaluate((element) => {
          const image = element as HTMLImageElement;
          return {
            width: image.naturalWidth,
            visible: getComputedStyle(image).display !== 'none',
            src: image.src.slice(0, 22),
          };
        });
      expect(result.width).toBeGreaterThan(200);
      expect(result.visible).toBe(true);
      expect(result.src).toBe('data:image/png;base64,');
    } finally {
      await fallback.context.close();
    }
    const reduced = await openOffline(html, { reducedMotion: true });
    try {
      expect(await reduced.page.locator('[data-shader-motion="paused"]').count()).toBe(1);
      const first = await sample(reduced.page);
      await reduced.page.waitForTimeout(250);
      expect(await sample(reduced.page)).toEqual(first);
    } finally {
      await reduced.context.close();
    }
  }, 30_000);
});

describe('isolated real animated WebM encoding', () => {
  it('encodes real frames with finite requested duration and no app UI, then releases every export resource', async () => {
    const result = await editor.evaluate(async () => {
      const { createNode, createShaderConfig, exportWebm } = window.folioExportTest;
      const tracks: MediaStreamTrack[] = [];
      const urls = new Set<string>();
      const originalCapture = HTMLCanvasElement.prototype.captureStream;
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      HTMLCanvasElement.prototype.captureStream = function (...args) {
        const stream = originalCapture.apply(this, args);
        tracks.push(...stream.getTracks());
        return stream;
      };
      URL.createObjectURL = (blob) => {
        const url = originalCreate(blob);
        urls.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        urls.delete(url);
        originalRevoke(url);
      };
      const progress: number[] = [];
      let blob: Blob;
      try {
        blob = await exportWebm(
          {
            id: 'video',
            name: 'Real motion',
            nodes: [
              createNode('frame', { id: 'background', width: 320, height: 240, fill: '#ffffff' }),
              createNode('rectangle', {
                id: 'animated',
                parentId: 'background',
                x: 20,
                y: 20,
                width: 200,
                height: 160,
                shader: createShaderConfig('mesh-gradient'),
              }),
              createNode('rectangle', {
                id: 'order',
                parentId: 'background',
                x: 0,
                y: 0,
                width: 12,
                height: 12,
                fill: '#00ff00',
              }),
            ],
          },
          { duration: 1, fps: 12, onProgress: (value) => progress.push(value) },
        );
      } finally {
        HTMLCanvasElement.prototype.captureStream = originalCapture;
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      }
      const video = document.createElement('video');
      video.muted = true;
      const url = URL.createObjectURL(blob);
      const loaded = new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('WebM playback failed.'));
      });
      video.src = url;
      document.body.append(video);
      try {
        await loaded;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d')!;
        const capture = async (time: number) => {
          const seeked = new Promise<void>((resolve) => (video.onseeked = () => resolve()));
          video.currentTime = time;
          await seeked;
          context.drawImage(video, 0, 0);
          return {
            pixels: canvas.toDataURL(),
            corner: [...context.getImageData(4, 4, 1, 1).data],
            background: [...context.getImageData(300, 220, 1, 1).data],
          };
        };
        const first = await capture(0.1);
        const later = await capture(0.8);
        video.currentTime = 0;
        let decodedFrames = 0;
        let callback = 0;
        const count = () => {
          decodedFrames += 1;
          callback = video.requestVideoFrameCallback(count);
        };
        callback = video.requestVideoFrameCallback(count);
        const ended = new Promise<void>((resolve) => (video.onended = () => resolve()));
        await video.play();
        await ended;
        video.cancelVideoFrameCallback(callback);
        return {
          type: blob.type,
          size: blob.size,
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          changes: first.pixels !== later.pixels,
          corner: later.corner,
          background: later.background,
          decodedFrames,
          progress,
          tracksEnded: tracks.every((track) => track.readyState === 'ended'),
          tracks: tracks.length,
          bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
          hosts: document.querySelectorAll('[data-folio-export-host]').length,
          urls: urls.size,
        };
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
        URL.revokeObjectURL(url);
      }
    });
    if (process.env.FOLIO_EXPORT_PROOF_PATH) {
      await writeFile(`${process.env.FOLIO_EXPORT_PROOF_PATH}.webm`, new Uint8Array(result.bytes));
      console.log('WebM proof', { ...result, bytes: result.bytes.length });
    }
    expect(result.type).toBe('video/webm');
    expect(result.size).toBeGreaterThan(2000);
    expect(result.duration).toBeCloseTo(1, 2);
    expect(result).toMatchObject({
      width: 320,
      height: 240,
      changes: true,
      tracksEnded: true,
      tracks: 1,
      hosts: 0,
      urls: 0,
    });
    expect(result.corner[1]).toBeGreaterThan(220);
    expect(result.corner[0]).toBeLessThan(30);
    expect(result.background.slice(0, 3).every((value) => value > 240)).toBe(true);
    expect(result.decodedFrames).toBeGreaterThanOrEqual(9);
    expect(result.progress[0]).toBe(0);
    expect(result.progress.at(-1)).toBe(1);
    expect(
      result.progress.every(
        (value, index) =>
          value >= 0 && value <= 1 && (index === 0 || value >= result.progress[index - 1]),
      ),
    ).toBe(true);
  }, 45_000);

  it('aborts in flight, stops tracks, revokes temporary URLs, and permits the next export', async () => {
    const result = await editor.evaluate(async () => {
      const { createNode, createShaderConfig, exportWebm } = window.folioExportTest;
      const controller = new AbortController();
      const tracks: MediaStreamTrack[] = [];
      const original = HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream = function (...args) {
        const stream = original.apply(this, args);
        tracks.push(...stream.getTracks());
        return stream;
      };
      const page = {
        id: 'abort',
        name: 'Abort',
        nodes: [
          createNode('rectangle', {
            width: 160,
            height: 120,
            shader: createShaderConfig('mesh-gradient'),
          }),
        ],
      };
      let error = '';
      const progress: number[] = [];
      try {
        await exportWebm(page, {
          duration: 3,
          fps: 24,
          signal: controller.signal,
          onProgress(value) {
            progress.push(value);
            if (value > 0.12) controller.abort();
          },
        });
      } catch (cause) {
        error = (cause as Error).name;
      } finally {
        HTMLCanvasElement.prototype.captureStream = original;
      }
      const remaining = document.querySelectorAll('[data-folio-export-host]').length;
      const next = await exportWebm(
        { ...page, nodes: [createNode('rectangle', { width: 80, height: 60 })] },
        { duration: 1, fps: 30 },
      );
      return {
        error,
        remaining,
        ended: tracks.every((track) => track.readyState === 'ended'),
        completed: progress.includes(1),
        next: next.size,
      };
    });
    expect(result).toMatchObject({
      error: 'AbortError',
      remaining: 0,
      ended: true,
      completed: false,
    });
    expect(result.next).toBeGreaterThan(100);
  }, 45_000);

  it('cleans up when setup is cancelled and when the encoder rejects its stream', async () => {
    const result = await editor.evaluate(async () => {
      const { createNode, exportWebm } = window.folioExportTest;
      const page = {
        id: 'failure',
        name: 'Failure',
        nodes: [createNode('rectangle', { width: 100, height: 80 })],
      };
      const controller = new AbortController();
      let aborted = '';
      try {
        await exportWebm(page, {
          duration: 1,
          fps: 12,
          signal: controller.signal,
          onProgress: () => controller.abort(),
        });
      } catch (cause) {
        aborted = (cause as Error).name;
      }
      const original = HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream = () => {
        throw new Error('Encoder refused stream');
      };
      let failed = '';
      try {
        await exportWebm(page, { duration: 1, fps: 12 });
      } catch (cause) {
        failed = (cause as Error).message;
      } finally {
        HTMLCanvasElement.prototype.captureStream = original;
      }
      return {
        aborted,
        failed,
        hosts: document.querySelectorAll('[data-folio-export-host]').length,
      };
    });
    expect(result).toEqual({ aborted: 'AbortError', failed: 'Encoder refused stream', hosts: 0 });
  }, 30_000);

  it('makes no external runtime/font/image requests or unhandled browser errors', () => {
    expect(externalRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
});
