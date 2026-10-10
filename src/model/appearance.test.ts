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
import { validateNode, validatePage } from '../../desktop/persistence/validation.mjs';
import type { DesignDocument, DesignNode, FrameLayout } from '../types';
import {
  DEFAULT_FILTERS,
  DEFAULT_INNER_SHADOW,
  DEFAULT_SHADOW,
  filterCss,
  nodeAppearance,
  nodeInnerShadow,
} from './appearance';

const layout: FrameLayout = {
  direction: 'row',
  gap: 10,
  paddingTop: 5,
  paddingRight: 5,
  paddingBottom: 5,
  paddingLeft: 5,
  align: 'start',
  justify: 'start',
};

function documentWith(...nodes: DesignNode[]): DesignDocument {
  const document = createDocument('Appearance');
  document.pages[0].nodes = nodes;
  return document;
}

describe('backward-compatible appearance', () => {
  it('leaves old documents unchanged and renders default appearance without effects', () => {
    const node = createNode('frame');
    const document = documentWith(node);
    expect(validateDocument(document)).toEqual(document);
    expect(node).not.toHaveProperty('widthMode');
    expect(node).not.toHaveProperty('clipContent');
    expect(nodeAppearance(node)).toEqual({
      overflow: 'visible',
      mixBlendMode: 'normal',
      boxShadow: undefined,
      filter: undefined,
    });
    expect(nodeInnerShadow(node)).toBeUndefined();
    expect(filterCss(DEFAULT_FILTERS)).toBeUndefined();
  });

  it('canonicalizes nested appearance, preserves JSON and duplication, and leaves history inputs intact', () => {
    const original = validateDocument(
      documentWith(
        createNode('frame', {
          id: 'frame',
          layout,
          widthMode: 'fit',
          heightMode: 'fit',
          clipContent: true,
          blendMode: 'multiply',
          shadow: DEFAULT_SHADOW,
          innerShadow: DEFAULT_INNER_SHADOW,
          filters: DEFAULT_FILTERS,
        }),
      ),
    );
    const changed = updateNodes(original, original.activePageId, ['frame'], {
      filters: { ...DEFAULT_FILTERS, blur: 3 },
    });
    expect(original.pages[0].nodes[0].filters?.blur).toBe(0);
    expect(changed.pages[0].nodes[0].filters?.blur).toBe(3);
    const copy = duplicateNodes(changed, changed.activePageId, ['frame']);
    const duplicated = copy.document.pages[0].nodes.find((node) => node.id === copy.ids[0])!;
    expect(duplicated).toMatchObject({
      widthMode: 'fit',
      heightMode: 'fit',
      clipContent: true,
      blendMode: 'multiply',
      shadow: DEFAULT_SHADOW,
      innerShadow: DEFAULT_INNER_SHADOW,
      filters: { ...DEFAULT_FILTERS, blur: 3 },
    });
    expect(validateDocument(JSON.parse(JSON.stringify(copy.document)))).toEqual(copy.document);
    const clean = validateNode({
      ...duplicated,
      shadow: { ...DEFAULT_SHADOW, injected: 'url(https://example.test)' },
    });
    expect(clean.shadow).toEqual(DEFAULT_SHADOW);
    expect(clean.shadow).not.toBe(duplicated.shadow);
  });

  it.each([
    { blendMode: 'url(https://example.test)' },
    { clipContent: 'true' },
    { widthMode: 'auto' },
    { widthMode: 'fit' },
    { heightMode: 'fit' },
    { shadow: { ...DEFAULT_SHADOW, color: 'red; background:url(https://example.test)' } },
    { shadow: { ...DEFAULT_SHADOW, x: Infinity } },
    { shadow: { ...DEFAULT_SHADOW, blur: -1 } },
    { innerShadow: { ...DEFAULT_INNER_SHADOW, spread: 1001 } },
    { filters: { ...DEFAULT_FILTERS, blur: 101 } },
    { filters: { ...DEFAULT_FILTERS, contrast: NaN } },
    { filters: { ...DEFAULT_FILTERS, brightness: -1 } },
    { filters: { ...DEFAULT_FILTERS, saturation: 5 } },
  ])('rejects invalid appearance before persistence or export: %j', (patch) => {
    const node = { ...createNode('frame'), ...patch };
    expect(() => validateNode(node)).toThrow(/Invalid document/);
    const page = { id: 'page', name: 'Unsafe', nodes: [node] };
    expect(() => exportPageHtml(page as never)).toThrow();
    expect(() => exportPageSvg(page as never)).toThrow();
  });

  it('restricts container-only properties to frames', () => {
    for (const patch of [{ clipContent: true }, { widthMode: 'fixed' }, { heightMode: 'fixed' }])
      expect(() => validateNode({ ...createNode('rectangle'), ...patch })).toThrow(/frames/);
  });

  it('composes CSS effects without changing old text or ellipse clipping', () => {
    const node = createNode('ellipse', {
      shadow: DEFAULT_SHADOW,
      innerShadow: DEFAULT_INNER_SHADOW,
      blendMode: 'screen',
      filters: { blur: 2, brightness: 1.2, contrast: 0.8, saturation: 0.5 },
    });
    expect(nodeAppearance(node)).toEqual({
      overflow: undefined,
      mixBlendMode: 'screen',
      boxShadow: '0px 4px 8px 0px #00000040',
      filter: 'blur(2px) brightness(1.2) contrast(0.8) saturate(0.5)',
    });
    expect(nodeInnerShadow(node)).toMatchObject({
      borderRadius: '50%',
      boxShadow: 'inset 0px 2px 4px 0px #00000040',
      pointerEvents: 'none',
    });
    expect(nodeAppearance(createNode('frame', { clipContent: true })).overflow).toBe('hidden');
  });
});

describe('fit-to-content frame sizing', () => {
  it('measures nested frames bottom-up with gap and padding and ignores hidden content', () => {
    const input = documentWith(
      createNode('frame', { id: 'outer', layout, widthMode: 'fit', heightMode: 'fit' }),
      createNode('frame', {
        id: 'inner',
        parentId: 'outer',
        layout: { ...layout, direction: 'column' },
        widthMode: 'fit',
        heightMode: 'fit',
      }),
      createNode('rectangle', { id: 'a', parentId: 'inner', width: 30, height: 20 }),
      createNode('rectangle', { id: 'b', parentId: 'inner', width: 40, height: 25 }),
      createNode('rectangle', { id: 'hidden', parentId: 'outer', width: 900, visible: false }),
    );
    const document = validateDocument(input);
    expect(document.pages[0].nodes[1]).toMatchObject({ width: 50, height: 65, x: 5, y: 5 });
    expect(document.pages[0].nodes[0]).toMatchObject({ width: 60, height: 75 });
    expect(input.pages[0].nodes[0].width).toBe(640);
    expect(validateDocument(document)).toEqual(document);
    const resized = updateNodes(document, document.activePageId, ['b'], { width: 80 });
    expect(resized.pages[0].nodes[0].width).toBe(100);
  });

  it('removes fit modes when flex is removed and retains resolved dimensions and children', () => {
    const document = validateDocument(
      documentWith(
        createNode('frame', { id: 'frame', layout, widthMode: 'fit', heightMode: 'fit' }),
        createNode('rectangle', { id: 'child', parentId: 'frame', width: 30, height: 20 }),
      ),
    );
    const next = updateNodes(document, document.activePageId, ['frame'], { layout: undefined });
    expect(next.pages[0].nodes[0]).toMatchObject({ width: 40, height: 30 });
    expect(next.pages[0].nodes[0]).not.toHaveProperty('widthMode');
    expect(next.pages[0].nodes[0]).not.toHaveProperty('heightMode');
    expect(next.pages[0].nodes[1]).toEqual(document.pages[0].nodes[1]);
  });

  it('keeps fit dimensions under cross-axis stretch and bounds oversized fitted content', () => {
    const document = validateDocument(
      documentWith(
        createNode('frame', { id: 'outer', layout: { ...layout, align: 'stretch' } }),
        createNode('frame', { id: 'inner', parentId: 'outer', layout, heightMode: 'fit' }),
        createNode('rectangle', { id: 'child', parentId: 'inner', height: 20 }),
      ),
    );
    expect(document.pages[0].nodes[1].height).toBe(30);
    expect(() =>
      validateDocument(
        documentWith(
          createNode('frame', { id: 'frame', layout, widthMode: 'fit' }),
          createNode('rectangle', { id: 'child', parentId: 'frame', width: 100000 }),
        ),
      ),
    ).toThrow(/dimension limit/);
  });

  it('is idempotent when nested row and column layouts mix fit dimensions with stretch', () => {
    const document = validateDocument(
      documentWith(
        createNode('frame', {
          id: 'outer',
          width: 500,
          height: 300,
          layout: { ...layout, align: 'stretch' },
        }),
        createNode('frame', {
          id: 'middle',
          parentId: 'outer',
          layout: { ...layout, direction: 'column', align: 'stretch' },
          widthMode: 'fit',
        }),
        createNode('frame', {
          id: 'inner',
          parentId: 'middle',
          width: 100,
          layout: { ...layout, align: 'stretch' },
          heightMode: 'fit',
        }),
        createNode('rectangle', { id: 'a', parentId: 'inner', width: 30, height: 20 }),
        createNode('rectangle', { id: 'b', parentId: 'inner', width: 40, height: 60 }),
      ),
    );
    expect(document.pages[0].nodes[1]).toMatchObject({ width: 110, height: 290 });
    expect(document.pages[0].nodes[2]).toMatchObject({ width: 100, height: 70 });
    expect(document.pages[0].nodes[3].height).toBe(60);
    expect(validateDocument(document)).toEqual(document);
    const wider = updateNodes(document, document.activePageId, ['outer'], { height: 500 });
    expect(wider.pages[0].nodes[1].height).toBe(490);
    expect(validateDocument(wider)).toEqual(wider);
    expect(validateDocument(JSON.parse(JSON.stringify(wider)))).toEqual(wider);
  });
});

describe('page color and color tokens', () => {
  it('roundtrips an optional hex page color without imposing a color on legacy pages', () => {
    const document = createDocument();
    expect(validatePage(document.pages[0])).not.toHaveProperty('canvasColor');
    document.pages[0].canvasColor = '#283040';
    expect(validateDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    for (const canvasColor of ['transparent', 'url(https://example.test)', '#xyz', null, 5])
      expect(() => validatePage({ ...document.pages[0], canvasColor })).toThrow(/canvasColor/);
  });

  it('resolves token updates across pages, detaches manual fill, and preserves resolved fill on deletion', () => {
    const input = documentWith(
      createNode('rectangle', { id: 'a', fill: '#000', fillTokenId: 'accent' }),
    );
    input.tokens = [{ id: 'accent', name: 'Accent', value: '#336699' }];
    input.pages.push({
      id: 'second-page',
      name: 'Page 2',
      nodes: [createNode('text', { id: 'b', fillTokenId: 'accent' })],
    });
    const document = validateDocument(input);
    expect(document.pages.map((page) => page.nodes[0].fill)).toEqual(['#336699', '#336699']);
    const next = validateDocument({
      ...document,
      tokens: [{ id: 'accent', name: 'Accent', value: '#123456' }],
    });
    expect(next.pages.map((page) => page.nodes[0].fill)).toEqual(['#123456', '#123456']);
    const manual = updateNodes(next, next.activePageId, ['a'], { fill: '#fedcba' });
    expect(manual.pages[0].nodes[0].fill).toBe('#fedcba');
    expect(manual.pages[0].nodes[0]).not.toHaveProperty('fillTokenId');
    expect(manual.pages[1].nodes[0].fillTokenId).toBe('accent');
    const removed = validateDocument({
      ...manual,
      tokens: [],
      pages: manual.pages.map((page) => ({
        ...page,
        nodes: page.nodes.map((node) => ({ ...node, fillTokenId: undefined })),
      })),
    });
    expect(removed.pages.map((page) => page.nodes[0].fill)).toEqual(['#fedcba', '#123456']);
    expect(exportPageSvg(removed.pages[1])).toContain('fill="#123456"');
  });

  it('bounds token count, IDs, names, opaque colors and dangling references', () => {
    const document = createDocument();
    const tokens = Array.from({ length: 256 }, (_, index) => ({
      id: `color-${index}`,
      name: `Color ${index}`,
      value: '#abc',
    }));
    expect(validateDocument({ ...document, tokens }).tokens).toHaveLength(256);
    expect(() =>
      validateDocument({
        ...document,
        tokens: [...tokens, { id: 'more', name: 'More', value: '#fff' }],
      }),
    ).toThrow(/256/);
    for (const patch of [
      { id: '../x' },
      { name: ' ' },
      { name: 'x'.repeat(129) },
      { value: '#aabbccdd' },
      { value: 'transparent' },
    ])
      expect(() =>
        validateDocument({ ...document, tokens: [{ ...tokens[0], ...patch }] }),
      ).toThrow();
    expect(() =>
      validateDocument({ ...document, tokens: [tokens[0], { ...tokens[1], name: ' color 0 ' }] }),
    ).toThrow(/duplicates/);
    expect(() =>
      validateDocument({ ...document, tokens: [tokens[0], { ...tokens[1], id: tokens[0].id }] }),
    ).toThrow(/duplicates/);
    expect(() =>
      validateDocument(documentWith(createNode('rectangle', { fillTokenId: 'missing' }))),
    ).toThrow(/existing color token/);
  });
});

describe('safe appearance exports', () => {
  it('exports clipping, shadows, blend and filters and includes effect overflow in bounds', () => {
    const node = createNode('frame', {
      id: 'effects',
      name: '<unsafe & "name">',
      width: 100,
      height: 80,
      radius: 10,
      clipContent: true,
      blendMode: 'multiply',
      shadow: { color: '#0008', x: 4, y: 6, blur: 8, spread: 2 },
      innerShadow: DEFAULT_INNER_SHADOW,
      filters: { ...DEFAULT_FILTERS, blur: 2, saturation: 0.5 },
    });
    const page = documentWith(
      node,
      createNode('rectangle', { id: 'overflow', parentId: 'effects', x: 1000 }),
    ).pages[0];
    const html = exportPageHtml(page);
    const svg = exportPageSvg(page);
    expect(html).toContain(
      'overflow:hidden;mix-blend-mode:multiply;box-shadow:4px 6px 8px 2px #0008;filter:blur(2px) saturate(0.5)',
    );
    expect(html).toContain('box-shadow:inset 0px 2px 4px 0px #00000040;');
    expect(svg).toContain('mix-blend-mode:multiply;filter:blur(2px) saturate(0.5)');
    expect(svg).toContain('clip-path="url(#folio-appearance-0-clip)"');
    expect(svg).toContain('<feGaussianBlur');
    expect(svg).toContain('tableValues="1 0"');
    expect(svg).toContain('viewBox="-16 -14 140 120"');
    expect(html).toContain('&lt;unsafe &amp; &quot;name&quot;&gt;');
    expect(svg).toContain('&lt;unsafe &amp; &quot;name&quot;&gt;');
    expect(html).not.toContain('<unsafe');
    expect(svg).not.toContain('<unsafe');
  });

  it('uses deterministic unique filter and clip IDs for nested effects and retains unclipped overflow by default', () => {
    const page = documentWith(
      createNode('frame', {
        id: 'parent',
        width: 100,
        height: 100,
        shadow: DEFAULT_SHADOW,
        innerShadow: DEFAULT_INNER_SHADOW,
      }),
      createNode('ellipse', {
        id: 'child',
        parentId: 'parent',
        x: 200,
        width: 20,
        height: 20,
        shadow: DEFAULT_SHADOW,
      }),
    ).pages[0];
    const svg = exportPageSvg(page);
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(svg).toContain('folio-appearance-0-shadow');
    expect(svg).toContain('folio-appearance-1-shadow');
    expect(svg).not.toContain('folio-appearance-0-clip');
    expect(exportPageHtml(page)).not.toContain('overflow:hidden');
  });
});
