import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDocumentStore } from './documents.mjs';
import {
  validateDocument,
  validateNode,
  validateShaderConfig,
  validateShaderSnapshot,
} from './validation.mjs';

const config = (overrides = {}) => ({
  kind: 'mesh-gradient',
  colors: ['#9386ff', '#ffd8e6'],
  speed: 0.5,
  scale: 1,
  detail: 0.7,
  paused: false,
  ...overrides,
});
const node = (overrides = {}) => ({
  id: 'node-1',
  type: 'rectangle',
  name: 'Shader',
  parentId: null,
  x: 0,
  y: 0,
  width: 400,
  height: 300,
  rotation: 0,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  radius: 16,
  opacity: 1,
  visible: true,
  locked: false,
  shader: config(),
  ...overrides,
});
const document = () => ({
  schemaVersion: 1,
  id: 'shader-study',
  name: 'Shader study',
  activePageId: 'page-1',
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  pages: [{ id: 'page-1', name: 'Page 1', nodes: [node()] }],
});
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=';
const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('restricted Paper shader persistence', () => {
  it.each(['mesh-gradient', 'grain-gradient', 'liquid-metal', 'waves', 'dot-orbit', 'smoke'])(
    'accepts the closed %s preset',
    (kind) => {
      expect(validateShaderConfig(config({ kind }))).toEqual(config({ kind }));
    },
  );

  it.each(['frame', 'rectangle', 'ellipse'])('supports a shader fill on a %s', (type) => {
    expect(validateNode(node({ type })).shader).toEqual(config());
  });

  it.each(['text', 'image'])('rejects a shader on unsupported %s nodes', (type) => {
    expect(() => validateNode(node({ type }))).toThrow(/shader.*only supported/);
  });

  it.each(['kind', 'colors', 'speed', 'scale', 'detail', 'paused'])(
    'requires the normalized %s field',
    (field) => {
      const input = config();
      delete input[field];
      expect(() => validateShaderConfig(input)).toThrow(new RegExp(field));
    },
  );

  it.each([
    null,
    [],
    'shader',
    new Date(),
    {},
    config({ kind: '__proto__' }),
    config({ kind: 'custom-glsl' }),
    config({ speed: NaN }),
    config({ speed: Infinity }),
    config({ speed: -1 }),
    config({ speed: 3.01 }),
    config({ scale: 0 }),
    config({ scale: 4.01 }),
    config({ scale: '1' }),
    config({ detail: -0.1 }),
    config({ detail: 1.01 }),
    config({ detail: Infinity }),
    config({ paused: 1 }),
    config({ paused: 'false' }),
    config({ colors: [] }),
    config({ colors: ['#fff'] }),
    config({ colors: new Array(2) }),
    config({ colors: Array(7).fill('#fff') }),
    config({ colors: ['red', '#fff'] }),
    config({ colors: ['#fff', 'url(https://example.com/image.png)'] }),
    config({ colors: ['#fff', '#ff00ff;display:none'] }),
    config({ colors: ['#fff', '<script>'] }),
    config({ kind: 'liquid-metal', colors: ['#fff', '#aaa', '#000'] }),
    config({ kind: 'waves', colors: ['#fff', '#aaa', '#000'] }),
  ])('rejects invalid or executable configuration %j', (input) => {
    expect(() => validateShaderConfig(input)).toThrow(/Invalid document: shader/);
  });

  it('accepts the range boundaries and bounded transparent/hex palettes', () => {
    for (const input of [
      config({ speed: 0, scale: 0.25, detail: 0, paused: true, colors: ['transparent', '#AbC8'] }),
      config({
        speed: 3,
        scale: 4,
        detail: 1,
        colors: ['#abc', '#ABCDEF80', '#1234', '#ABCDEF', '#000', '#fff'],
      }),
    ])
      expect(validateShaderConfig(input)).toEqual(input);
  });

  it('projects code, URLs, unknown uniforms, and prototype fields out of the configuration', () => {
    const input = config({
      fragmentShader: 'void main() {}',
      image: 'https://example.com',
      onload: '<script>',
      uniforms: { u_url: 'file:///secret' },
    });
    Object.defineProperty(input, '__proto__', { value: { polluted: true }, enumerable: true });
    const output = validateShaderConfig(input);
    expect(output).toEqual(config());
    expect(output.colors).not.toBe(input.colors);
    expect(Object.hasOwn(output, '__proto__')).toBe(false);
    expect(JSON.stringify(output)).not.toContain('example.com');
  });

  it('retains shader fills through desktop atomic save and reload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'folio-shader-'));
    directories.push(directory);
    const store = createDocumentStore(directory);
    const source = document();
    await store.saveDocument(source);
    const loaded = await store.loadDocument(source.id);
    expect(loaded).toEqual(validateDocument(source));
    expect(loaded.pages[0].nodes[0].shader).toEqual(config());
  });
});

describe('bounded raster-only shader snapshots', () => {
  it('accepts PNG bytes and accounts for their shared byte budget', () => {
    const budget = { imageBytes: 0 };
    expect(validateShaderSnapshot(PNG, 'snapshot', budget)).toBe(PNG);
    expect(budget.imageBytes).toBe(Buffer.from(PNG.split(',')[1], 'base64').length);
  });

  it.each([
    null,
    '',
    'https://example.com/shader.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,PHN2Zz4=',
    'data:image/png;base64,',
    'data:image/png;base64,iVBORw0KGgp=',
    PNG.replace('image/png', 'image/jpeg'),
    PNG + '" onclick="alert(1)',
  ])('rejects a non-PNG or malformed snapshot: %s', (input) => {
    expect(() => validateShaderSnapshot(input)).toThrow(/shader snapshot/);
  });

  it('caps individual and aggregate snapshot bytes', () => {
    expect(() => validateShaderSnapshot(`data:image/png;base64,${'A'.repeat(14_000_000)}`)).toThrow(
      /10 MiB/,
    );
    expect(() => validateShaderSnapshot(PNG, 'snapshot', { imageBytes: 20 * 1024 * 1024 })).toThrow(
      /20 MiB/,
    );
  });
});
