import { describe, expect, it } from 'vitest';
import * as paper from '@paper-design/shaders';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateShaderConfig } from '../../desktop/persistence/validation.mjs';
import { createShaderConfig, SHADER_CATALOG, SHADER_PRESETS } from './presets';
import { getPaperShaderSpec, shaderSpeed } from './runtime';
import { shaderDefinition } from './schema.mjs';
import { ShaderControls } from './ShaderControls';

describe('complete upstream Paper shader catalog', () => {
  it('covers every upstream fragment exactly once while preserving the featured six', () => {
    expect(SHADER_CATALOG).toHaveLength(30);
    expect(new Set(SHADER_CATALOG.map(({ id }) => id)).size).toBe(30);
    expect(SHADER_CATALOG.slice(0, 6)).toEqual(SHADER_PRESETS);
    expect(SHADER_CATALOG.filter(({ category }) => category === 'effect')).toHaveLength(20);
    expect(SHADER_CATALOG.filter(({ category }) => category === 'image-filter')).toHaveLength(7);
    expect(SHADER_CATALOG.filter(({ category }) => category === 'logo')).toHaveLength(3);
    const upstream = Object.entries(paper).filter(([name]) => name.endsWith('FragmentShader')).map(([, fragment]) => fragment);
    const local = SHADER_CATALOG.map(({ config }) => getPaperShaderSpec(config).fragmentShader);
    expect(new Set(local)).toEqual(new Set(upstream));
    expect(new Set(local).size).toBe(30);
  });

  it.each(SHADER_CATALOG)('has valid independent defaults and metadata for $id', (preset) => {
    const first = createShaderConfig(preset.id);
    const second = createShaderConfig(preset.id);
    expect(validateShaderConfig(first)).toEqual(first);
    expect(first).toEqual(preset.config);
    expect(first).not.toBe(second);
    expect(first.colors).not.toBe(second.colors);
    expect(preset.supportsImage).toBe(preset.category !== 'effect');
    expect(preset.motion).toBe(preset.animated ? 'animated' : 'static');
    expect(shaderSpeed({ ...first, paused: false, speed: 2 }, false)).toBe(preset.animated ? 2 : 0);
    expect(shaderSpeed({ ...first, paused: false, speed: 2 }, true)).toBe(0);
  });

  it.each(SHADER_CATALOG)('supplies all declared GLSL uniforms and safe editable parameters for $id', ({ id }) => {
    const config = createShaderConfig(id);
    const spec = getPaperShaderSpec(config);
    expect(spec.fragmentShader.startsWith('#version 300 es')).toBe(true);
    const provided = new Set([...Object.keys(spec.uniforms), ...Object.keys(spec.textures), 'u_time', 'u_resolution', 'u_pixelRatio', 'u_imageAspectRatio']);
    const declarations = [...spec.fragmentShader.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(u_\w+)/g)].map((match) => match[1]);
    expect(declarations.filter((name) => !provided.has(name))).toEqual([]);
    for (const [key, value] of Object.entries(spec.uniforms)) {
      expect(key).toMatch(/^u_[a-zA-Z][a-zA-Z0-9]*$/);
      for (const scalar of Array.isArray(value) ? value.flat() : [value])
        expect(typeof scalar === 'boolean' || (typeof scalar === 'number' && Number.isFinite(scalar))).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    const changed = getPaperShaderSpec({ ...config, detail: config.detail === 1 ? 0 : 1 });
    expect(changed.uniforms).not.toEqual(spec.uniforms);
    for (const [name, parameter] of Object.entries(shaderDefinition(id)!.parameters)) {
      const value = parameter.type === 'boolean' ? !parameter.default : parameter.max!;
      const modified = getPaperShaderSpec({ ...config, parameters: { [name]: value } });
      expect(modified.uniforms[`u_${name}`]).toBe(value);
    }
  });

  it('accepts smoke-ring as a backward-compatible name without duplicating the catalog', () => {
    const alias = createShaderConfig('smoke-ring');
    const original = createShaderConfig('smoke');
    expect(validateShaderConfig(alias).kind).toBe('smoke-ring');
    expect(getPaperShaderSpec(alias).fragmentShader).toBe(paper.smokeRingFragmentShader);
    expect(getPaperShaderSpec(alias).uniforms).toEqual(getPaperShaderSpec(original).uniforms);
  });

  it.each(SHADER_CATALOG)('provides labeled controls and image upload when needed for $id', ({ config, supportsImage, animated }) => {
    const html = renderToStaticMarkup(createElement(ShaderControls, { config, onChange() {} }));
    expect(html).toContain('Effect settings');
    expect(html).toContain('Scale');
    for (const parameter of Object.values(shaderDefinition(config.kind)!.parameters))
      expect(html).toContain(parameter.label);
    expect(html.includes('type="file"')).toBe(supportsImage);
    expect(html.includes('Shader source image')).toBe(supportsImage);
    expect(html.includes('Pause animation')).toBe(animated);
  });
});