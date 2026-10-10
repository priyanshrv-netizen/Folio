import { describe, expect, it } from 'vitest';
import { SHADER_PRESETS, createShaderConfig } from './presets';
import { shaderConfigKey, shaderPixelBudget, shaderSpeed, SHADER_MAX_PIXELS } from './runtime';
import { prepareShaderSnapshots } from './snapshots';
import { createDocument, createNode } from '../model';

describe('Paper renderer resource and motion limits', () => {
  it.each([
    [108, 84],
    [1920, 1080],
    [100000, 100000],
    [2048, 1],
    [1, 2048],
  ])('bounds physical pixels for %s × %s', (width, height) => {
    const pixels = shaderPixelBudget(width, height);
    expect(pixels).toBeGreaterThanOrEqual(1);
    expect(pixels).toBeLessThanOrEqual(SHADER_MAX_PIXELS);
    const ratio = Math.sqrt(pixels / (width * height));
    expect(ratio).toBeLessThanOrEqual(1.5);
    expect(width * ratio).toBeLessThanOrEqual(2048);
    expect(height * ratio).toBeLessThanOrEqual(2048);
  });

  it.each([
    [0, 100],
    [NaN, 100],
    [Infinity, 100],
    [1, 100000],
    [100000, 1],
  ])('rejects unsafe render dimensions %s × %s', (width, height) => {
    expect(() => shaderPixelBudget(width, height)).toThrow(/dimensions/);
  });

  it.each(SHADER_PRESETS)('honors pause and reduced motion for $id', ({ config }) => {
    expect(shaderSpeed(config, true)).toBe(0);
    expect(shaderSpeed({ ...config, paused: true }, false)).toBe(0);
    expect(shaderSpeed(config, false)).toBe(config.kind === 'waves' ? 0 : config.speed);
  });

  it('keys configurations canonically and excludes executable extra fields', () => {
    const config = createShaderConfig('smoke');
    expect(shaderConfigKey({ ...config, image: 'https://example.com' } as typeof config)).toBe(
      shaderConfigKey(config),
    );
    expect(shaderConfigKey({ ...config, detail: 0.3 })).not.toBe(shaderConfigKey(config));
  });

  it('does not invoke the browser renderer for pages without visible shader fills', async () => {
    const document = createDocument();
    document.pages[0].nodes = [
      createNode('frame', {
        id: 'hidden',
        visible: false,
        shader: createShaderConfig('mesh-gradient'),
      }),
      createNode('rectangle', { parentId: 'hidden', shader: createShaderConfig('smoke') }),
      createNode('ellipse', { opacity: 0, shader: createShaderConfig('dot-orbit') }),
      createNode('text'),
    ];
    expect(Object.keys(await prepareShaderSnapshots(document.pages[0]))).toEqual([]);
  });
});
