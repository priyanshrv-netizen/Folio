import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocumentStore } from './documents.mjs';
import { validateDocument, validateShaderConfig, validateShaderSource, validateNode } from './validation.mjs';
import { SHADER_CATALOG, createShaderConfig } from '../../src/shaders/presets.ts';
import { shaderDefinition } from '../../src/shaders/schema.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=';
const node = (shader) => ({
  id: `node-${shader.kind}`, type: 'rectangle', name: shader.kind, parentId: null,
  x: 0, y: 0, width: 400, height: 300, rotation: 0, fill: '#fff', stroke: '#000',
  strokeWidth: 1, radius: 16, opacity: 1, visible: true, locked: false, shader,
});
const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('full catalog shader persistence boundary', () => {
  it.each(SHADER_CATALOG)('round trips bounded scalar parameters for $id', ({ id, supportsImage }) => {
    const config = createShaderConfig(id);
    config.parameters = Object.fromEntries(Object.entries(shaderDefinition(id).parameters).map(([name, rule]) => [name, rule.default]));
    if (supportsImage) config.source = PNG;
    const safe = validateShaderConfig(JSON.parse(JSON.stringify(config)));
    expect(safe).toEqual(config);
    expect(safe.parameters).not.toBe(config.parameters);
    expect(validateNode(node(config)).shader).toEqual(config);
  });

  it.each(SHADER_CATALOG)('rejects unsafe values for every allowed parameter of $id', ({ id }) => {
    for (const [name, rule] of Object.entries(shaderDefinition(id).parameters)) {
      for (const value of rule.type === 'boolean'
        ? [0, 1, 'true', null, [], {}]
        : [NaN, Infinity, -Infinity, rule.min - 0.001, rule.max + 0.001, '0', null, [], {}])
        expect(() => validateShaderConfig({ ...createShaderConfig(id), parameters: { [name]: value } })).toThrow(new RegExp(`parameters.${name}`));
      if (rule.step === 1)
        expect(() => validateShaderConfig({ ...createShaderConfig(id), parameters: { [name]: rule.min + 0.5 } })).toThrow(/integer/);
    }
  });

  it.each(SHADER_CATALOG.filter(({ supportsImage }) => supportsImage))('rejects external and executable image sources for $id', ({ id }) => {
    for (const source of [
      'https://example.com/image.png', 'file:///secret.png', 'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zy8+', 'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/png;base64,PHN2Zy8+', PNG.replace('image/png', 'image/jpeg'), PNG + '" onload="alert(1)',
    ]) expect(() => validateShaderConfig({ ...createShaderConfig(id), source })).toThrow(/source/);
  });

  it.each(SHADER_CATALOG.filter(({ supportsImage }) => !supportsImage))('rejects unused sources on $id', ({ id }) => {
    expect(() => validateShaderConfig({ ...createShaderConfig(id), source: PNG })).toThrow(/only supported/);
  });

  it('strips untrusted GLSL, unknown uniforms, options from other kinds, and prototype keys', () => {
    const config = createShaderConfig('water');
    const parameters = JSON.parse('{"__proto__":{"polluted":true},"caustic":0.4,"shape":5,"u_image":"https://example.com","fragmentShader":"void main(){}"}');
    const safe = validateShaderConfig({ ...config, parameters, fragmentShader: 'void main(){}', source: PNG });
    expect(safe.parameters).toEqual({ caustic: 0.4 });
    expect(Object.hasOwn(safe.parameters, '__proto__')).toBe(false);
    expect(safe).not.toHaveProperty('fragmentShader');
  });

  it('rejects non-plain parameter objects and shares image byte limits with the document', () => {
    for (const parameters of [null, [], new Date(), 'x'])
      expect(() => validateShaderConfig({ ...createShaderConfig('water'), parameters })).toThrow(/parameters/);
    const bytes = Buffer.from(PNG.split(',')[1], 'base64').length;
    const budget = { nodes: 0, text: 0, imageBytes: 20 * 1024 * 1024 - bytes };
    validateNode(node({ ...createShaderConfig('water'), source: PNG }), 'node', budget);
    expect(budget.imageBytes).toBe(20 * 1024 * 1024);
    expect(() => validateNode(node({ ...createShaderConfig('heatmap'), source: PNG }), 'node', budget)).toThrow(/20 MiB/);
    expect(() => validateShaderSource(`data:image/png;base64,${'A'.repeat(14_000_000)}`)).toThrow(/10 MiB/);
  });

  it('retains all thirty shader kinds, image sources, and parameters through atomic save/load', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'folio-shader-catalog-'));
    directories.push(directory);
    const store = createDocumentStore(directory);
    const document = {
      schemaVersion: 1, id: 'catalog', name: 'Paper catalog', activePageId: 'page-1',
      createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
      pages: [{ id: 'page-1', name: 'All effects', nodes: SHADER_CATALOG.map(({ config, supportsImage }) => node({ ...config, ...(supportsImage ? { source: PNG } : {}) })) }],
    };
    await store.saveDocument(document);
    expect(await store.loadDocument(document.id)).toEqual(validateDocument(document));
  });
});