import { describe, expect, it } from 'vitest';
import { createNode } from '../model';
import { createShaderConfig } from '../shaders/presets';
import {
  escapeHtml,
  exportScene,
  inertJson,
  MAX_VIDEO_PIXELS,
  videoDimensions,
  videoOptions,
} from './scene';
import { exportAnimatedHtml, exportWebm } from './index';

describe('bounded animation exports', () => {
  it('keeps the public APIs lazy at import time', () => {
    expect(exportAnimatedHtml).toBeTypeOf('function');
    expect(exportWebm).toBeTypeOf('function');
  });

  it.each([12, 24, 30])('accepts the video UI frame rate %s', (fps) => {
    expect(videoOptions(15, fps)).toEqual({ duration: 15, fps, frames: 15 * fps });
  });

  it.each([0, -1, Infinity, NaN, 15.1])('rejects invalid duration %s', (duration) => {
    expect(() => videoOptions(duration, 24)).toThrow(/duration/);
  });

  it.each([0, 60, 1, Infinity, NaN])('rejects unsupported fps %s', (fps) => {
    expect(() => videoOptions(3, fps)).toThrow(/frame rate/);
  });

  it.each([
    [1920, 1080],
    [100000, 1],
    [1, 100000],
    [100000, 100000],
    [320, 240],
  ])('bounds encoder dimensions for %s × %s', (width, height) => {
    const result = videoDimensions(width, height);
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_VIDEO_PIXELS);
    expect(result.width).toBeLessThanOrEqual(1920);
    expect(result.height).toBeLessThanOrEqual(1920);
    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
  });

  it('rejects remote image assets and malformed geometry before starting export', () => {
    const page = { id: 'page', name: 'Unsafe', nodes: [createNode('image')] };
    expect(() =>
      exportScene({ ...page, nodes: [{ ...page.nodes[0], src: 'https://example.com/a.png' }] }),
    ).toThrow(/embedded/);
    expect(() => exportScene({ ...page, nodes: [{ ...page.nodes[0], width: NaN }] })).toThrow(
      /finite/,
    );
  });

  it('bounds visible contexts and includes inherited visibility and layout normalization', () => {
    const hidden = createNode('frame', { id: 'hidden', visible: false });
    const nodes = Array.from({ length: 9 }, (_, index) =>
      createNode('rectangle', {
        id: `shader-${index}`,
        width: 80,
        height: 80,
        shader: createShaderConfig('mesh-gradient'),
      }),
    );
    expect(() => exportScene({ id: 'page', name: 'Nine', nodes })).toThrow(/at most 8/);
    expect(
      exportScene({
        id: 'page',
        name: 'Hidden',
        nodes: [hidden, ...nodes.map((node) => ({ ...node, parentId: hidden.id }))],
      }).shaders,
    ).toHaveLength(0);
  });

  it('rejects excessive combined shader pixel allocations', () => {
    const nodes = Array.from({ length: 5 }, (_, index) =>
      createNode('rectangle', {
        id: `shader-${index}`,
        width: 2048,
        height: 2048,
        shader: createShaderConfig('mesh-gradient'),
      }),
    );
    expect(() => exportScene({ id: 'page', name: 'Large', nodes })).toThrow(/pixel budget/);
  });

  it('escapes script, style and HTML terminators without changing inert JSON data', () => {
    const value = '</script><script>globalThis.hacked=true</script><!--\u2028&';
    const serialized = inertJson({ value });
    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('&');
    expect(JSON.parse(serialized)).toEqual({ value });
    expect(escapeHtml(value)).not.toContain('<');
  });

  it('honors an already aborted signal without browser APIs or allocations', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportWebm(
        { id: 'page', name: 'Empty', nodes: [] },
        { duration: 1, fps: 12, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
