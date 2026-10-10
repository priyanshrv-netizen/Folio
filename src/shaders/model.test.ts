import { describe, expect, it } from 'vitest';
import {
  createDocument,
  createNode,
  duplicateNodes,
  exportPageHtml,
  exportPageSvg,
  updateNodes,
  validateDocument,
} from '../model';
import type { DesignNode, ShaderSnapshots } from '../types';
import { SHADER_PRESETS, createShaderConfig } from './presets';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=';

function documentWith(...nodes: DesignNode[]) {
  const document = createDocument('Shader study');
  document.pages[0].nodes = nodes;
  return document;
}

describe('Paper shader configuration in the document model', () => {
  it('offers six distinct genuine presets with independent editable palettes', () => {
    expect(SHADER_PRESETS.map((item) => item.id)).toEqual([
      'mesh-gradient',
      'grain-gradient',
      'liquid-metal',
      'waves',
      'dot-orbit',
      'smoke',
    ]);
    for (const preset of SHADER_PRESETS) {
      const first = createShaderConfig(preset.id);
      const second = createShaderConfig(preset.id);
      expect(first).toEqual(preset.config);
      expect(first).not.toBe(second);
      expect(first.colors).not.toBe(second.colors);
      first.colors[0] = '#123456';
      expect(preset.config.colors[0]).not.toBe('#123456');
    }
  });

  it.each(SHADER_PRESETS)('round-trips the $id preset on all supported shapes', ({ id }) => {
    const document = documentWith(
      ...(['frame', 'rectangle', 'ellipse'] as const).map((type) =>
        createNode(type, { shader: createShaderConfig(id) }),
      ),
    );
    const clean = validateDocument(JSON.parse(JSON.stringify(document)));
    expect(clean).toEqual(document);
    expect(clean.pages[0].nodes[0].shader).not.toBe(document.pages[0].nodes[0].shader);
    expect(clean.pages[0].nodes[0].shader!.colors).not.toBe(
      document.pages[0].nodes[0].shader!.colors,
    );
  });

  it('duplicates shader frames and children with independent configuration objects', () => {
    const document = documentWith(
      createNode('frame', { id: 'frame', shader: createShaderConfig('mesh-gradient') }),
      createNode('ellipse', {
        id: 'child',
        parentId: 'frame',
        shader: createShaderConfig('dot-orbit'),
      }),
    );
    const before = JSON.stringify(document);
    const copy = duplicateNodes(document, document.activePageId, ['frame']).document;
    const [original, child, clone, childClone] = copy.pages[0].nodes;
    expect(clone.shader).toEqual(original.shader);
    expect(childClone.shader).toEqual(child.shader);
    expect(clone.shader!.colors).not.toBe(original.shader!.colors);
    clone.shader!.colors[0] = '#123456';
    expect(original.shader!.colors[0]).not.toBe('#123456');
    expect(JSON.stringify(document)).toBe(before);
  });

  it('keeps prior snapshots immutable for undo and supports removing the shader fill', () => {
    const first = documentWith(
      createNode('rectangle', { id: 'shader', shader: createShaderConfig('smoke') }),
    );
    const before = JSON.stringify(first);
    const second = updateNodes(first, first.activePageId, ['shader'], {
      shader: {
        ...first.pages[0].nodes[0].shader!,
        paused: true,
        detail: 0.9,
        colors: ['#222222', '#eeeeee'],
      },
    });
    const third = updateNodes(second, first.activePageId, ['shader'], { shader: undefined });
    expect(second.pages[0].nodes[0].shader).toMatchObject({ paused: true, detail: 0.9 });
    expect(third.pages[0].nodes[0]).not.toHaveProperty('shader');
    expect(JSON.stringify(first)).toBe(before);
    expect(validateDocument(JSON.parse(before))).toEqual(first);
    expect(second.pages[0].nodes[0].shader).not.toBe(first.pages[0].nodes[0].shader);
  });
});

describe('safe shader snapshot exports', () => {
  it.each([exportPageSvg, exportPageHtml])(
    'refuses to silently drop a visible shader fill',
    (exportPage) => {
      const page = documentWith(
        createNode('rectangle', { id: 'shader', shader: createShaderConfig('mesh-gradient') }),
      ).pages[0];
      expect(() => exportPage(page)).toThrow(/needs a snapshot.*prepareShaderSnapshots/);
      expect(() => exportPage(page, { unrelated: PNG })).toThrow(/needs a snapshot/);
    },
  );

  it.each([exportPageSvg, exportPageHtml])(
    'does not require snapshots for hidden nodes or descendants',
    (exportPage) => {
      const page = documentWith(
        createNode('frame', {
          id: 'hidden',
          visible: false,
          shader: createShaderConfig('mesh-gradient'),
        }),
        createNode('rectangle', {
          id: 'child',
          parentId: 'hidden',
          shader: createShaderConfig('grain-gradient'),
        }),
        createNode('ellipse', {
          id: 'transparent',
          opacity: 0,
          shader: createShaderConfig('dot-orbit'),
        }),
      ).pages[0];
      const output = exportPage(page);
      expect(output).not.toContain('data-shader-kind');
      expect(output).not.toContain('data-node-id');
    },
  );

  it.each(['frame', 'rectangle', 'ellipse'] as const)(
    'clips the %s snapshot and preserves stroke, transform, and child order',
    (type) => {
      const shape = createNode(type, {
        id: 'shader',
        name: 'Shader <art>',
        width: 200,
        height: 120,
        radius: 24,
        shader: createShaderConfig('liquid-metal'),
        stroke: '#ff0000',
        strokeWidth: 4,
        rotation: 12,
        opacity: 0.75,
      });
      const page = documentWith(
        shape,
        ...(type === 'frame'
          ? [createNode('text', { id: 'child', parentId: 'shader', text: 'Above the shader' })]
          : []),
      ).pages[0];
      const before = JSON.stringify(page);
      const svg = exportPageSvg(page, { shader: PNG });
      expect(svg).toContain(`href="${PNG}"`);
      expect(svg).toContain('data-shader-kind="liquid-metal" data-shader-export="snapshot"');
      expect(svg).toContain('clip-path="url(#folio-shader-0)"');
      expect(svg).toContain('preserveAspectRatio="none"');
      expect(svg).toContain('rotate(12 100 60)');
      expect(svg).toContain('opacity="0.75"');
      expect(svg).toContain('fill="transparent" stroke="#ff0000" stroke-width="4"');
      expect(svg).toContain(
        type === 'ellipse'
          ? '<ellipse cx="100" cy="60" rx="100" ry="60"'
          : '<rect width="200" height="120" rx="24"',
      );
      const html = exportPageHtml(page, { shader: PNG });
      expect(html).toContain(`src="${PNG}"`);
      expect(html).toContain('alt="Shader &lt;art&gt;"');
      expect(html).toContain(type === 'ellipse' ? 'border-radius:50%;' : 'border-radius:24px;');
      expect(html.indexOf(`src="${PNG}"`)).toBeLessThan(html.indexOf('border:4px solid #ff0000;'));
      if (type === 'frame') {
        expect(svg.indexOf(`href="${PNG}"`)).toBeLessThan(svg.indexOf('data-node-id="child"'));
        expect(html.indexOf(`src="${PNG}"`)).toBeLessThan(html.indexOf('data-node-id="child"'));
      }
      expect(JSON.stringify(page)).toBe(before);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('https://');
    },
  );

  it.each([
    'https://example.com/shader.png',
    'javascript:alert(1)',
    'file:///image.png',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,AAAA',
    PNG.replace('image/png', 'image/jpeg'),
    PNG + '" onerror="alert(1)',
    'data:image/png;base64,iVBORw0KGgp=',
  ])('rejects unsafe or invalid snapshot data: %s', (snapshot) => {
    const page = documentWith(
      createNode('rectangle', { id: 'shader', shader: createShaderConfig('waves') }),
    ).pages[0];
    for (const exportPage of [exportPageSvg, exportPageHtml]) {
      expect(() => exportPage(page, { shader: snapshot })).toThrow(/snapshot/);
    }
  });

  it('does not trust a snapshot inherited through the map prototype', () => {
    const page = documentWith(
      createNode('rectangle', { id: 'shader', shader: createShaderConfig('waves') }),
    ).pages[0];
    const snapshots = Object.create({ shader: PNG }) as ShaderSnapshots;
    expect(() => exportPageSvg(page, snapshots)).toThrow(/needs a snapshot/);
    expect(() => exportPageHtml(page, snapshots)).toThrow(/needs a snapshot/);
  });

  it('keeps shader configuration and PNG snapshots separate from editable JSON', () => {
    const page = documentWith(
      createNode('rectangle', { id: 'shader', shader: createShaderConfig('waves') }),
    ).pages[0];
    const snapshots = Object.freeze({ shader: PNG });
    expect(exportPageSvg(page, snapshots)).toBe(exportPageSvg(page, snapshots));
    expect(exportPageHtml(page, snapshots)).toBe(exportPageHtml(page, snapshots));
    expect(JSON.stringify(page)).not.toContain('data:image');
    expect(page.nodes[0].shader?.kind).toBe('waves');
  });
});
