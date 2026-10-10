import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { SHADER_CATALOG } from './presets';

let server: ViteDevServer;
let browser: Browser;
let page: Page;
const externalRequests: string[] = [];
const browserErrors: string[] = [];

beforeAll(async () => {
  server = await createServer({
    configFile: false, appType: 'custom', cacheDir: 'node_modules/.vite-shader-tests',
    optimizeDeps: { entries: ['src/shaders/runtime.ts'] },
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
  });
  server.middlewares.use((request, response, next) => {
    if (request.url !== '/__paper_shader_test') return next();
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><title>Paper shader render tests</title></head><body></body></html>');
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') externalRequests.push(request.url());
  });
  await page.goto(`${server.resolvedUrls!.local[0]}__paper_shader_test`);
  await page.addScriptTag({ type: 'module', content: `
    import * as runtime from '/src/shaders/runtime.ts';
    import * as sources from '/src/shaders/sources.ts';
    import * as presets from '/src/shaders/presets.ts';
    window.shaderTest = { ...runtime, ...sources, ...presets };
  ` });
  await page.waitForFunction(() => 'shaderTest' in window);
}, 30_000);

afterAll(async () => {
  if (process.env.FOLIO_SHADER_PROOF_PATH && page) {
    await page.setViewportSize({ width: 1500, height: 1200 });
    await page.screenshot({ path: process.env.FOLIO_SHADER_PROOF_PATH, fullPage: true });
  }
  await browser?.close();
  await server?.close();
});

describe('real WebGL2 rendering of the complete Paper catalog', () => {
  it.each(SHADER_CATALOG)('renders, updates, snapshots, and disposes the original $id shader', async ({ config, animated, name }) => {
    const result = await page.evaluate(async (config) => {
      const { mountPaperShader, waitForShaderPaint } = (window as unknown as { shaderTest: typeof import('./runtime') }).shaderTest;
      const host = document.createElement('div');
      Object.assign(host.style, { width: '280px', height: '210px', position: 'relative' });
      document.body.append(host);
      const controller = new AbortController();
      const renderer = await mountPaperShader(host, config, 280, 210, controller.signal);
      try {
        await waitForShaderPaint(controller.signal);
        const canvas = renderer.mount.canvasElement;
        const gl = canvas.getContext('webgl2')!;
        const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
        const linked = program !== null && gl.getProgramParameter(program, gl.LINK_STATUS);
        const data = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        const colors = new Set<string>();
        for (let index = 0; index < data.length; index += 4) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`);
        const first = renderer.snapshot();
        renderer.mount.setFrame(10_000);
        const later = renderer.snapshot();
        renderer.update({ ...config, detail: config.detail === 1 ? 0 : 1, paused: true }, true);
        const changed = renderer.snapshot();
        const error = gl.getError();
        renderer.dispose();
        return { linked, colors: colors.size, png: first, moves: first !== later, changes: later !== changed, error, remaining: host.querySelectorAll('canvas').length };
      } finally {
        renderer.dispose();
        controller.abort();
        host.remove();
      }
    }, config);
    expect(result.linked).toBe(true);
    expect(result.colors).toBeGreaterThanOrEqual(['dithering', 'halftone-dots'].includes(config.kind) ? 2 : 5);
    expect(result.png.startsWith('data:image/png;base64,')).toBe(true);
    expect(result.moves).toBe(animated);
    expect(result.changes).toBe(true);
    expect(result.error).toBe(0);
    expect(result.remaining).toBe(0);
    if (process.env.FOLIO_SHADER_PROOF_PATH) await page.evaluate(({ png, name }) => {
      let gallery = document.getElementById('gallery');
      if (!gallery) {
        document.body.style.cssText = 'margin:24px;background:#151821;color:#fff;font:14px system-ui';
        const heading = document.createElement('h1');
        heading.textContent = 'Paper Shaders · all 30 genuine GLSL effects';
        document.body.append(heading);
        gallery = document.createElement('div');
        gallery.id = 'gallery';
        gallery.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:16px';
        document.body.append(gallery);
      }
      const card = document.createElement('div');
      const image = document.createElement('img');
      image.src = png;
      image.style.cssText = 'width:100%;border-radius:12px;display:block;margin-bottom:8px';
      const label = document.createElement('div');
      label.textContent = name;
      card.append(image, label);
      gallery.append(card);
    }, { png: result.png, name });
  }, 30_000);

  it.each(['liquid-metal', 'heatmap', 'gem-smoke'] as const)('preprocesses an embedded raster logo for %s without external assets', async (kind) => {
    const result = await page.evaluate(async (kind) => {
      const { mountPaperShader, waitForShaderPaint, shaderDemoSource, createShaderConfig } = (window as unknown as { shaderTest: typeof import('./runtime') & typeof import('./sources') & typeof import('./presets') }).shaderTest;
      const config = { ...createShaderConfig(kind), source: shaderDemoSource(true) };
      const host = document.createElement('div');
      Object.assign(host.style, { width: '240px', height: '200px', position: 'relative' });
      document.body.append(host);
      const controller = new AbortController();
      const renderer = await mountPaperShader(host, config, 240, 200, controller.signal);
      try {
        await waitForShaderPaint(controller.signal);
        const png = renderer.snapshot();
        const gl = renderer.mount.canvasElement.getContext('webgl2')!;
        return { pngLength: png.length, error: gl.getError() };
      } finally {
        renderer.dispose();
        controller.abort();
        host.remove();
      }
    }, kind);
    expect(result.pngLength).toBeGreaterThan(2_000);
    expect(result.error).toBe(0);
  }, 30_000);

  it('uploads and replaces an embedded image through accessible controls and reports unsafe uploads', async () => {
    await page.addScriptTag({ type: 'module', content: `
      import { mountShaderControlsFixture } from '/src/shaders/testing/controls-fixture.tsx';
      window.unmountShaderControlsFixture = mountShaderControlsFixture('water');
    ` });
    const input = page.getByLabel('Shader source image', { exact: true });
    await input.waitFor();
    try {
      await input.setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
      await page.getByRole('alert').filter({ hasText: 'SVG and external URLs are not supported' }).waitFor();
      const source = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 2_000;
        canvas.height = 1_000;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#fe715e'; context.fillRect(0, 0, 2000, 1000);
        context.fillStyle = '#325984'; context.fillRect(400, 200, 1200, 600);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      await input.setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: Buffer.from(source, 'base64') });
      await page.getByAltText('Current shader source').waitFor();
      await page.locator('#shader-controls-fixture .shader-live[data-shader-status="ready"]').waitFor();
      expect(await page.getByRole('alert').count()).toBe(0);
      const size = await page.getByAltText('Current shader source').evaluate((image) => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight }));
      expect(size).toEqual({ width: 1536, height: 768 });
      const config = JSON.parse((await page.getByLabel('Shader fixture configuration').textContent())!);
      expect(config.source).toMatch(/^data:image\/png;base64,/);
      await page.getByText('Effect settings', { exact: true }).click();
      await page.getByLabel('Caustics', { exact: true }).fill('0.9');
      const changed = JSON.parse((await page.getByLabel('Shader fixture configuration').textContent())!);
      expect(changed.parameters.caustic).toBe(0.9);
      await page.getByRole('button', { name: 'Use default source' }).click();
      await page.getByAltText('Current shader source').waitFor({ state: 'detached' });
      await page.locator('#shader-controls-fixture .shader-live[data-shader-status="ready"]').waitFor();
      expect(JSON.parse((await page.getByLabel('Shader fixture configuration').textContent())!)).not.toHaveProperty('source');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('#shader-controls-fixture .shader-live[data-shader-motion="paused"]').waitFor();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.locator('#shader-controls-fixture .shader-live[data-shader-motion="playing"]').waitFor();
    } finally {
      await page.evaluate(() => (window as unknown as { unmountShaderControlsFixture(): void }).unmountShaderControlsFixture());
    }
  }, 30_000);

  it('rejects oversized decoded images before normalization and bounds narrow logo preprocessing', async () => {
    const result = await page.evaluate(async () => {
      const { importShaderSource, paperShaderTextures, getPaperShaderSpec, createShaderConfig } = (window as unknown as { shaderTest: typeof import('./runtime') & typeof import('./sources') & typeof import('./presets') }).shaderTest;
      const canvas = document.createElement('canvas');
      canvas.width = 8193; canvas.height = 1;
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
      let error = '';
      try { await importShaderSource(new File([blob], 'too-wide.png', { type: 'image/png' })); }
      catch (cause) { error = (cause as Error).message; }
      canvas.width = 1; canvas.height = 1536;
      canvas.getContext('2d')!.fillRect(0, 0, 1, 1536);
      const config = { ...createShaderConfig('liquid-metal'), source: canvas.toDataURL('image/png') };
      const textures = await paperShaderTextures(config, getPaperShaderSpec(config));
      return { error, width: textures.u_image.naturalWidth, height: textures.u_image.naturalHeight };
    });
    expect(result.error).toContain('8192 pixels');
    expect(result.width).toBeLessThanOrEqual(2048);
    expect(result.height).toBeLessThanOrEqual(2048);
    expect(result.width).toBe(result.height);
  }, 30_000);

  it('shows an explicit WebGL2 fallback instead of a fake shader', async () => {
    const fallbackPage = await browser.newPage();
    await fallbackPage.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        return type === 'webgl2' ? null : Reflect.apply(original, this, [type, ...args]);
      } as typeof original;
    });
    try {
      await fallbackPage.goto(`${server.resolvedUrls!.local[0]}__paper_shader_test`);
      await fallbackPage.addScriptTag({ type: 'module', content: `
        import { mountShaderControlsFixture } from '/src/shaders/testing/controls-fixture.tsx';
        mountShaderControlsFixture('mesh-gradient');
      ` });
      await fallbackPage.getByText('WebGL2 is required', { exact: true }).waitFor();
      expect(await fallbackPage.locator('.shader-error').count()).toBe(1);
      expect(await fallbackPage.locator('.shader-live canvas').count()).toBe(0);
    } finally {
      await fallbackPage.close();
    }
  });

  it('uses no remote image/runtime requests and raises no browser exceptions', () => {
    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });
});