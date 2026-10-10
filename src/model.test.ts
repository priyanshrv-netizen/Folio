import { describe, expect, it } from 'vitest';
import type { DesignDocument, DesignNode, DesignPage, NodeType } from './types';
import {
  createDocument,
  createNode,
  duplicateNodes,
  exportPageHtml,
  exportPageSvg,
  removeNodes,
  updateNodes,
  validateDocument,
  worldPosition,
} from './model';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function documentWith(...nodes: DesignNode[]): DesignDocument {
  const doc = createDocument('Test document');
  doc.pages[0].nodes = nodes;
  return doc;
}

function nestedDocument(): DesignDocument {
  return documentWith(
    createNode('rectangle', { id: 'leaf', name: 'Leaf', parentId: 'panel', x: 5, y: 6 }),
    createNode('frame', { id: 'root', name: 'Root', x: 100, y: 200, width: 300, height: 200 }),
    createNode('ellipse', { id: 'sibling', name: 'Sibling', x: 10, y: 10 }),
    createNode('frame', {
      id: 'panel',
      name: 'Panel',
      parentId: 'root',
      x: 20,
      y: 30,
      width: 100,
      height: 100,
    }),
  );
}

function pageWith(...nodes: DesignNode[]): DesignPage {
  return documentWith(...nodes).pages[0];
}

function viewBox(svg: string): number[] {
  return /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);
}

describe('document and node creation', () => {
  it('creates one genuinely blank active page with independent IDs and ISO dates', () => {
    const doc = createDocument();
    expect(doc.name).toBe('Untitled');
    expect(doc.schemaVersion).toBe(1);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].nodes).toEqual([]);
    expect(doc.activePageId).toBe(doc.pages[0].id);
    expect(doc.id).not.toBe(doc.activePageId);
    expect(doc.createdAt).toBe(doc.updatedAt);
    expect(new Date(doc.createdAt).toISOString()).toBe(doc.createdAt);
    expect(validateDocument(doc)).toEqual(doc);
    expect(createDocument().id).not.toBe(doc.id);
    expect(createDocument('Portfolio').name).toBe('Portfolio');
  });

  it.each([
    ['frame', 640, 480],
    ['rectangle', 180, 120],
    ['ellipse', 120, 120],
    ['text', 240, 60],
  ] as const)('matches the renderer default dimensions for %s', (type, width, height) => {
    expect(createNode(type)).toMatchObject({ width, height });
  });

  it.each<NodeType>(['frame', 'rectangle', 'ellipse', 'text', 'image'])(
    'creates a valid %s node',
    (type) => {
      const node = createNode(type);
      expect(node.type).toBe(type);
      expect(node.parentId).toBeNull();
      expect(node.visible).toBe(true);
      expect(node.locked).toBe(false);
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
      expect(validateDocument(documentWith(node)).pages[0].nodes[0]).toEqual(node);
      expect(createNode(type).id).not.toBe(node.id);
    },
  );

  it('applies overrides without changing the requested type', () => {
    const node = createNode('text', {
      id: 'text-1',
      x: -20,
      opacity: 0.5,
      text: '<hello>',
      type: 'image',
    });
    expect(node).toMatchObject({
      id: 'text-1',
      type: 'text',
      x: -20,
      opacity: 0.5,
      text: '<hello>',
      fontSize: 24,
    });
  });

  it('rejects invalid creation values instead of starting an invalid document', () => {
    expect(() => createDocument('')).toThrow(/name/);
    expect(() => createDocument('a'.repeat(257))).toThrow(/256/);
    expect(() => createNode('rectangle', { width: -1 })).toThrow(/width/);
    expect(() => createNode('script' as NodeType)).toThrow(/type/);
  });
});

describe('document validation', () => {
  it('round-trips every supported node type, optional property, page, and image', () => {
    const doc = nestedDocument();
    doc.pages.push({
      id: 'second-page',
      name: 'Second page',
      nodes: [
        createNode('text', {
          id: 'rich-text',
          text: 'Hello\n\nWorld & <friends> 🚀',
          fontFamily: 'Georgia',
          fontSize: 18.5,
          fontWeight: 650,
          textAlign: 'right',
          locked: true,
          fill: '#abcd',
          stroke: '#11223344',
          strokeWidth: 2.5,
          rotation: -12.5,
        }),
        createNode('image', { id: 'picture', src: PNG, radius: 16, opacity: 0.4 }),
      ],
    });
    doc.activePageId = 'second-page';
    const validated = validateDocument(JSON.parse(JSON.stringify(doc)));
    expect(validated).toEqual(doc);
    expect(validated).not.toBe(doc);
    expect(validated.pages[0].nodes[0]).not.toBe(doc.pages[0].nodes[0]);
  });

  it('projects unknown and prototype-pollution fields out at every level', () => {
    const doc = documentWith(createNode('rectangle'));
    const input = JSON.parse(JSON.stringify(doc));
    input.script = '<script>alert(1)</script>';
    input.pages[0].onload = 'alert(1)';
    input.pages[0].nodes[0].style = 'background:url(https://evil.example)';
    Object.defineProperty(input, '__proto__', { value: { polluted: true }, enumerable: true });
    Object.defineProperty(input.pages[0].nodes[0], '__proto__', {
      value: { polluted: true },
      enumerable: true,
    });
    const result = validateDocument(input);
    expect(result).toEqual(doc);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
    expect(Object.hasOwn(result.pages[0].nodes[0], '__proto__')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('evil.example');
    expect(input.script).toContain('<script>');
  });

  it.each([null, undefined, [], 42, 'document', new Date()])(
    'rejects a non-document value: %s',
    (input) => {
      expect(() => validateDocument(input)).toThrow(/Invalid document: document/);
    },
  );

  it.each(['schemaVersion', 'id', 'name', 'pages', 'activePageId', 'createdAt', 'updatedAt'])(
    'requires document.%s',
    (key) => {
      const input = { ...createDocument() } as Record<string, unknown>;
      delete input[key];
      expect(() => validateDocument(input)).toThrow(new RegExp(key));
    },
  );

  it.each(['id', 'name', 'nodes'])('requires page.%s', (key) => {
    const doc = createDocument();
    delete (doc.pages[0] as unknown as Record<string, unknown>)[key];
    expect(() => validateDocument(doc)).toThrow(new RegExp(`pages\\[0\\].${key}`));
  });

  it.each([
    'id',
    'type',
    'name',
    'parentId',
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'fill',
    'stroke',
    'strokeWidth',
    'radius',
    'opacity',
    'visible',
    'locked',
  ])('requires node.%s', (key) => {
    const doc = documentWith(createNode('rectangle'));
    delete (doc.pages[0].nodes[0] as unknown as Record<string, unknown>)[key];
    expect(() => validateDocument(doc)).toThrow(new RegExp(key));
  });

  it.each([
    ['schemaVersion', 2],
    ['pages', []],
    ['pages', {}],
    ['activePageId', 'missing'],
    ['id', 'unsafe" onclick="alert'],
    ['name', ' '],
    ['name', 'a'.repeat(257)],
    ['createdAt', 'yesterday'],
    ['updatedAt', '2026-02-30T00:00:00.000Z'],
    ['createdAt', '2026-01-01'],
    ['updatedAt', null],
  ])('rejects invalid document field %s = %s', (key, value) => {
    const doc = { ...createDocument(), [key as string]: value };
    expect(() => validateDocument(doc)).toThrow(/Invalid document:/);
  });

  it.each([
    ['x', NaN],
    ['x', Infinity],
    ['y', -Infinity],
    ['x', 1_000_001],
    ['y', -1_000_001],
    ['width', 0],
    ['width', -1],
    ['width', 100_001],
    ['height', '200'],
    ['height', null],
    ['rotation', 361],
    ['rotation', -361],
    ['strokeWidth', -1],
    ['strokeWidth', 1_001],
    ['radius', -1],
    ['radius', 100_001],
    ['opacity', 1.01],
    ['opacity', -0.01],
    ['visible', 1],
    ['locked', 'false'],
    ['type', 'script'],
    ['parentId', 7],
    ['fontSize', 0],
    ['fontSize', 1_001],
    ['fontSize', Infinity],
    ['fontWeight', 0],
    ['fontWeight', 1_001],
    ['fontWeight', 400.5],
    ['textAlign', 'justify'],
    ['fontFamily', 'Inter; background:url(https://evil.example)'],
    ['fontFamily', 'Not in the whitelist'],
    ['text', 42],
    ['text', '\u0000'],
    ['text', '\ud800'],
    ['name', '\uffff'],
    ['src', null],
  ])('rejects invalid node field %s = %s', (key, value) => {
    const doc = documentWith(createNode('rectangle'));
    Object.assign(doc.pages[0].nodes[0], { [key as string]: value });
    expect(() => validateDocument(doc)).toThrow(new RegExp(key as string));
  });

  it.each(['#abc', '#aBcD', '#123456', '#ABCDEF80', 'transparent'])(
    'accepts the restricted color %s',
    (fill) => {
      expect(createNode('rectangle', { fill, stroke: fill }).fill).toBe(fill);
    },
  );

  it.each([
    'red',
    '#ab',
    '#12345',
    '#1234567',
    '#123456789',
    'rgb(0,0,0)',
    'url(https://evil.example)',
    '#fff;opacity:0',
    'var(--fill)',
  ])('rejects unsafe or unsupported paint %s', (fill) => {
    const doc = documentWith(createNode('rectangle'));
    doc.pages[0].nodes[0].fill = fill;
    expect(() => validateDocument(doc)).toThrow(/fill/);
    doc.pages[0].nodes[0].fill = '#fff';
    doc.pages[0].nodes[0].stroke = fill;
    expect(() => validateDocument(doc)).toThrow(/stroke/);
  });

  it('accepts supported font families, optional fields omitted, fractions, and range boundaries', () => {
    for (const fontFamily of [
      'Inter',
      'Arial',
      'Georgia',
      'Times New Roman',
      'Courier New',
      'system-ui',
      'sans-serif',
      'serif',
      'monospace',
    ]) {
      expect(createNode('text', { fontFamily }).fontFamily).toBe(fontFamily);
    }
    const node = createNode('rectangle', {
      x: -1_000_000,
      y: 1_000_000,
      width: 1,
      height: 100_000,
      rotation: -360,
      radius: 100_000,
      opacity: 0,
      strokeWidth: 1_000,
    });
    expect(validateDocument(documentWith(node)).pages[0].nodes[0]).toEqual(node);
    expect(createNode('rectangle', { x: 0.125, width: 1.5 }).width).toBe(1.5);
    const minimalText = { ...node, type: 'text' as const };
    expect(validateDocument(documentWith(minimalText)).pages[0].nodes[0].text).toBeUndefined();
  });

  it('rejects duplicate document, page, and node IDs, including across pages', () => {
    const doc = documentWith(createNode('rectangle', { id: 'shared-node' }));
    doc.pages[0].nodes.push(createNode('ellipse', { id: 'shared-node' }));
    expect(() => validateDocument(doc)).toThrow(/duplicates.*ID/);
    doc.pages[0].nodes.pop();
    doc.pages.push({
      id: 'other-page',
      name: 'Other',
      nodes: [createNode('text', { id: 'shared-node' })],
    });
    expect(() => validateDocument(doc)).toThrow(/duplicates.*ID/);
    doc.pages[1].nodes = [];
    doc.pages[1].id = doc.pages[0].id;
    expect(() => validateDocument(doc)).toThrow(/duplicates.*ID/);
    doc.pages.pop();
    doc.pages[0].nodes[0].id = doc.id;
    expect(() => validateDocument(doc)).toThrow(/duplicates.*ID/);
  });

  it('rejects dangling, non-frame, and cross-page parents', () => {
    const child = createNode('rectangle', { id: 'child', parentId: 'parent' });
    expect(() => validateDocument(documentWith(child))).toThrow(/parent frame in the same page/);
    const doc = documentWith(child, createNode('ellipse', { id: 'parent' }));
    expect(() => validateDocument(doc)).toThrow(/parent frame/);
    doc.pages[0].nodes.pop();
    doc.pages.push({
      id: 'other-page',
      name: 'Other',
      nodes: [createNode('frame', { id: 'parent' })],
    });
    expect(() => validateDocument(doc)).toThrow(/same page/);
  });

  it('rejects self-parenting and multi-node cycles, regardless of node order', () => {
    expect(() =>
      validateDocument(documentWith(createNode('frame', { id: 'self', parentId: 'self' }))),
    ).toThrow(/cycle/);
    const doc = documentWith(
      createNode('frame', { id: 'a', parentId: 'b' }),
      createNode('frame', { id: 'b', parentId: 'c' }),
      createNode('frame', { id: 'c', parentId: 'a' }),
    );
    expect(() => validateDocument(doc)).toThrow(/cycle/);
  });

  it('limits hierarchy depth with both ancestor-first and descendant-first ordering', () => {
    const nodes = Array.from({ length: 101 }, (_, index) =>
      createNode('frame', {
        id: `frame-${index}`,
        parentId: index === 0 ? null : `frame-${index - 1}`,
      }),
    );
    expect(() => validateDocument(documentWith(...nodes))).toThrow(/nesting limit/);
    expect(() => validateDocument(documentWith(...[...nodes].reverse()))).toThrow(/nesting limit/);
    expect(validateDocument(documentWith(...nodes.slice(0, 100))).pages[0].nodes).toHaveLength(100);
  });

  it('rejects sparse arrays and malformed structural objects', () => {
    const doc = createDocument();
    doc.pages = new Array(1);
    expect(() => validateDocument(doc)).toThrow(/pages\[0\]/);
    doc.pages = [{ id: 'page-one', name: 'One', nodes: new Array(1) }];
    expect(() => validateDocument(doc)).toThrow(/nodes\[0\]/);
    doc.pages[0].nodes = [null as unknown as DesignNode];
    expect(() => validateDocument(doc)).toThrow(/nodes\[0\]/);
  });

  it('limits page, node, and text counts', () => {
    const doc = createDocument();
    doc.pages = Array.from({ length: 101 }, (_, index) => ({
      id: `page-${index}`,
      name: 'Page',
      nodes: [],
    }));
    expect(() => validateDocument(doc)).toThrow(/100 pages/);
    const tooManyNodes = documentWith(
      ...Array.from({ length: 5_001 }, (_, index) => createNode('rectangle', { id: `n-${index}` })),
    );
    expect(() => validateDocument(tooManyNodes)).toThrow(/5,000 nodes/);
    const tooMuchText = documentWith(createNode('text'));
    tooMuchText.pages[0].nodes[0].text = 'x'.repeat(100_001);
    expect(() => validateDocument(tooMuchText)).toThrow(/100000 characters/);
    const aggregateText = documentWith(
      ...Array.from({ length: 11 }, () => createNode('text', { text: 'x'.repeat(100_000) })),
    );
    expect(() => validateDocument(aggregateText)).toThrow(/total text limit/);
  });

  it('enforces the total node limit across individually valid pages', () => {
    const doc = createDocument();
    doc.pages = Array.from({ length: 3 }, (_, pageIndex) => ({
      id: `page-${pageIndex}`,
      name: 'Page',
      nodes: Array.from({ length: pageIndex === 2 ? 1 : 5_000 }, (_, nodeIndex) =>
        createNode('rectangle', { id: `node-${pageIndex}-${nodeIndex}` }),
      ),
    }));
    doc.activePageId = doc.pages[0].id;
    expect(() => validateDocument(doc)).toThrow(/10,000 node/);
  });

  it.each([PNG, GIF])('accepts embedded raster images', (src) => {
    expect(validateDocument(documentWith(createNode('image', { src }))).pages[0].nodes[0].src).toBe(
      src,
    );
  });

  it.each([
    'https://example.com/image.png',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png,not-base64',
    'data:image/png;base64,',
    'data:image/png;base64,AAAA!',
    'data:image/png;base64,PHN2Zy8+',
    PNG.replace('image/png', 'image/jpeg'),
    PNG.replace('base64,', 'base64,\n'),
    'data:image/png;base64,iVBORw0KGgp=',
  ])('rejects remote, active, mislabeled, or malformed image data', (src) => {
    const doc = documentWith(createNode('image'));
    doc.pages[0].nodes[0].src = src;
    expect(() => validateDocument(doc)).toThrow(/src/);
  });

  it('validates optional image sources even on non-image nodes', () => {
    const doc = documentWith(createNode('rectangle'));
    doc.pages[0].nodes[0].src = 'https://evil.example';
    expect(() => validateDocument(doc)).toThrow(/src/);
  });

  it('caps individual and total embedded image bytes', () => {
    const doc = documentWith(createNode('image'));
    doc.pages[0].nodes[0].src = `data:image/png;base64,${'A'.repeat(14_000_000)}`;
    expect(() => validateDocument(doc)).toThrow(/10 MiB/);
    const src = `data:image/png;base64,iVBORw0KGgoA${'AAAA'.repeat(1_700_000)}`;
    const node = createNode('image', { src });
    const aggregate = documentWith(
      ...Array.from({ length: 5 }, (_, index) => ({ ...node, id: `image-${index}` })),
    );
    expect(() => validateDocument(aggregate)).toThrow(/32 MiB/);
  });

  it('accepts individual raster payloads larger than 5 MiB and below the 10 MiB limit', () => {
    const src = `data:image/png;base64,iVBORw0KGgoA${'AAAA'.repeat(3_200_000)}`;
    const doc = documentWith(createNode('image', { src }));
    expect(validateDocument(doc).pages[0].nodes[0].src).toBe(src);
  });

  it('measures the document byte limit using UTF-8 rather than JavaScript character counts', () => {
    const doc = documentWith(
      ...[3_200_000, 3_200_000, 1_937_500].map((groups) =>
        createNode('image', {
          src: `data:image/png;base64,iVBORw0KGgoA${'AAAA'.repeat(groups)}`,
        }),
      ),
      createNode('text', { text: '界'.repeat(100_000) }),
    );
    const json = JSON.stringify(doc);
    expect(json.length).toBeLessThan(32 * 1024 * 1024);
    expect(new TextEncoder().encode(json).length).toBeGreaterThan(32 * 1024 * 1024);
    expect(() => validateDocument(doc)).toThrow(/32 MiB/);
  });
});

describe('immutable document edits', () => {
  it('updates only selected nodes in the requested page and keeps original data unchanged', () => {
    const doc = nestedDocument();
    doc.updatedAt = '2020-01-01T00:00:00.000Z';
    doc.pages.push({
      id: 'other-page',
      name: 'Other',
      nodes: [createNode('text', { id: 'other-text' })],
    });
    const before = JSON.stringify(doc);
    const updated = updateNodes(doc, doc.activePageId, ['leaf', 'sibling', 'missing'], {
      fill: '#ff00ff',
      x: -40,
    });
    expect(JSON.stringify(doc)).toBe(before);
    expect(updated).not.toBe(doc);
    expect(updated.updatedAt).not.toBe(doc.updatedAt);
    expect(updated.createdAt).toBe(doc.createdAt);
    expect(updated.pages[1]).toEqual(doc.pages[1]);
    expect(updated.pages[0].nodes.filter((node) => ['leaf', 'sibling'].includes(node.id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'leaf', fill: '#ff00ff', x: -40 }),
        expect.objectContaining({ id: 'sibling', fill: '#ff00ff', x: -40 }),
      ]),
    );
    expect(updated.pages[0].nodes.find((node) => node.id === 'root')).toEqual(
      doc.pages[0].nodes.find((node) => node.id === 'root'),
    );
  });

  it('rejects unsafe patches, ID mutation, and hierarchy-breaking updates atomically', () => {
    const doc = nestedDocument();
    const before = JSON.stringify(doc);
    expect(() => updateNodes(doc, doc.activePageId, ['root'], { parentId: 'panel' })).toThrow(
      /cycle/,
    );
    expect(() => updateNodes(doc, doc.activePageId, ['root'], { type: 'ellipse' })).toThrow(
      /parent frame/,
    );
    expect(() => updateNodes(doc, doc.activePageId, ['leaf'], { width: Infinity })).toThrow(
      /width/,
    );
    expect(() => updateNodes(doc, doc.activePageId, ['leaf'], { id: 'renamed' })).toThrow(
      /IDs cannot/,
    );
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('removes a selected frame and all descendants even when descendants precede their parents', () => {
    const doc = nestedDocument();
    const before = JSON.stringify(doc);
    const updated = removeNodes(doc, doc.activePageId, ['root', 'leaf', 'root']);
    expect(updated.pages[0].nodes.map((node) => node.id)).toEqual(['sibling']);
    expect(JSON.stringify(doc)).toBe(before);
    expect(validateDocument(updated)).toEqual(updated);
  });

  it('removes just a child subtree without removing its ancestor or siblings', () => {
    const doc = nestedDocument();
    const updated = removeNodes(doc, doc.activePageId, ['panel']);
    expect(updated.pages[0].nodes.map((node) => node.id)).toEqual(['root', 'sibling']);
    const leafOnly = removeNodes(doc, doc.activePageId, ['leaf']);
    expect(leafOnly.pages[0].nodes.map((node) => node.id)).toEqual(['root', 'sibling', 'panel']);
  });

  it('duplicates each subtree once, remaps all parents, and offsets only selected roots', () => {
    const doc = nestedDocument();
    const before = JSON.stringify(doc);
    const { document: copy, ids } = duplicateNodes(doc, doc.activePageId, [
      'root',
      'panel',
      'leaf',
      'root',
    ]);
    const originals = new Set(doc.pages[0].nodes.map((node) => node.id));
    const clones = copy.pages[0].nodes.filter((node) => !originals.has(node.id));
    expect(copy.pages[0].nodes).toHaveLength(7);
    expect(clones).toHaveLength(3);
    expect(ids).toHaveLength(1);
    const root = clones.find((node) => node.id === ids[0])!;
    const panel = clones.find((node) => node.name === 'Panel')!;
    const leaf = clones.find((node) => node.name === 'Leaf')!;
    expect(root).toMatchObject({ name: 'Root copy', x: 124, y: 224, parentId: null });
    expect(panel).toMatchObject({ x: 20, y: 30, parentId: root.id });
    expect(leaf).toMatchObject({ x: 5, y: 6, parentId: panel.id });
    expect(worldPosition(leaf, copy.pages[0].nodes)).toEqual({ x: 149, y: 260 });
    expect(new Set(copy.pages[0].nodes.map((node) => node.id)).size).toBe(7);
    expect(JSON.stringify(doc)).toBe(before);
    expect(validateDocument(copy)).toEqual(copy);
  });

  it('keeps a duplicated nested subtree under its unselected parent', () => {
    const doc = nestedDocument();
    const { document: copy, ids } = duplicateNodes(doc, doc.activePageId, ['panel', 'leaf']);
    const panel = copy.pages[0].nodes.find((node) => node.id === ids[0])!;
    const leaf = copy.pages[0].nodes.find((node) => node.parentId === panel.id)!;
    expect(ids).toHaveLength(1);
    expect(panel).toMatchObject({ x: 44, y: 54, parentId: 'root' });
    expect(leaf).toMatchObject({ x: 5, y: 6 });
    expect(copy.pages[0].nodes).toHaveLength(6);
  });

  it('duplicates independent roots in layer order and preserves image/text properties', () => {
    const doc = documentWith(
      createNode('image', { id: 'image', src: PNG, rotation: 32, radius: 16 }),
      createNode('text', {
        id: 'text',
        name: 'a'.repeat(256),
        text: 'Words',
        fontFamily: 'Georgia',
        locked: true,
      }),
    );
    const { document: copy, ids } = duplicateNodes(doc, doc.activePageId, ['text', 'image']);
    const clones = copy.pages[0].nodes.slice(2);
    expect(clones.map((node) => node.id)).toEqual(ids);
    expect(clones[0]).toMatchObject({
      type: 'image',
      src: PNG,
      rotation: 32,
      radius: 16,
      x: 24,
      y: 24,
    });
    expect(clones[1]).toMatchObject({
      type: 'text',
      text: 'Words',
      fontFamily: 'Georgia',
      locked: true,
    });
    expect(clones[1].name).toHaveLength(256);
  });

  it('does not split Unicode surrogate pairs when suffixing a maximum-length duplicate name', () => {
    const doc = documentWith(
      createNode('rectangle', { id: 'unicode', name: `${'a'.repeat(250)}🚀bbbb` }),
    );
    const { document: copy, ids } = duplicateNodes(doc, doc.activePageId, ['unicode']);
    expect(copy.pages[0].nodes.find((node) => node.id === ids[0])!.name).toBe(
      `${'a'.repeat(250)} copy`,
    );
    expect(validateDocument(copy)).toEqual(copy);
  });

  it('rejects a duplicate that would exceed bounded coordinates without altering the source', () => {
    const doc = documentWith(createNode('rectangle', { id: 'edge', x: 1_000_000 }));
    expect(() => duplicateNodes(doc, doc.activePageId, ['edge'])).toThrow(/x/);
    expect(doc.pages[0].nodes).toHaveLength(1);
    expect(doc.pages[0].nodes[0].x).toBe(1_000_000);
  });

  it('treats stale or empty selections as no-ops and reports missing pages', () => {
    const doc = nestedDocument();
    for (const ids of [[], ['missing']]) {
      expect(updateNodes(doc, doc.activePageId, ids, { x: 1 })).toBe(doc);
      expect(removeNodes(doc, doc.activePageId, ids)).toBe(doc);
      expect(duplicateNodes(doc, doc.activePageId, ids)).toEqual({ document: doc, ids: [] });
    }
    expect(() => updateNodes(doc, 'missing', [], {})).toThrow(/Page "missing" does not exist/);
    expect(() => removeNodes(doc, 'missing', [])).toThrow(/Page "missing" does not exist/);
    expect(() => duplicateNodes(doc, 'missing', [])).toThrow(/Page "missing" does not exist/);
  });
});

describe('world coordinates', () => {
  it('accumulates parent-local offsets independent of flat array ordering', () => {
    const nodes = nestedDocument().pages[0].nodes;
    expect(
      worldPosition(
        nodes.find((node) => node.id === 'leaf')!,
        nodes,
      ),
    ).toEqual({ x: 125, y: 236 });
    expect(
      worldPosition(
        nodes.find((node) => node.id === 'root')!,
        nodes,
      ),
    ).toEqual({ x: 100, y: 200 });
  });

  it('transforms a child layout origin through center-rotated ancestors', () => {
    const parent = createNode('frame', {
      id: 'parent',
      x: 100,
      y: 200,
      width: 100,
      height: 100,
      rotation: 90,
    });
    const child = createNode('rectangle', { parentId: parent.id, x: 10, y: 20, rotation: 45 });
    const position = worldPosition(child, [child, parent]);
    expect(position.x).toBeCloseTo(180);
    expect(position.y).toBeCloseTo(210);
    expect(worldPosition(parent, [parent])).toEqual({ x: 100, y: 200 });
  });

  it('reports dangling or cyclic ancestry rather than returning a misleading position or looping', () => {
    const child = createNode('rectangle', { id: 'child', parentId: 'missing' });
    expect(() => worldPosition(child, [child])).toThrow(/parent frame/);
    const a = createNode('frame', { id: 'a', parentId: 'b' });
    const b = createNode('frame', { id: 'b', parentId: 'a' });
    expect(() => worldPosition(a, [a, b])).toThrow(/cycle/);
    const nonFrame = createNode('ellipse', { id: 'missing' });
    expect(() => worldPosition(child, [child, nonFrame])).toThrow(/parent frame/);
  });
});

describe('safe SVG and HTML exports', () => {
  it('exports a finite empty canvas and fits negative positions including centered strokes', () => {
    const empty = createDocument().pages[0];
    expect(viewBox(exportPageSvg(empty))).toEqual([0, 0, 1200, 800]);
    expect(exportPageHtml(empty)).toContain('width:1200px;height:800px;');
    const page = pageWith(
      createNode('rectangle', {
        x: -120,
        y: -80,
        width: 50,
        height: 30,
        stroke: '#000',
        strokeWidth: 2,
      }),
    );
    expect(viewBox(exportPageSvg(page))).toEqual([-121, -81, 52, 32]);
    const html = exportPageHtml(page);
    expect(html).toContain('width:52px;height:32px;');
    expect(html).toContain('left:1px;top:1px;width:50px;height:30px;');
  });

  it('fits children extending outside frames and respects nested center rotations', () => {
    const frame = createNode('frame', {
      id: 'frame',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 90,
    });
    const child = createNode('rectangle', {
      id: 'child',
      parentId: 'frame',
      x: -300,
      y: -200,
      width: 20,
      height: 10,
    });
    const page = pageWith(child, frame);
    const [x, y, width, height] = viewBox(exportPageSvg(page));
    expect(x).toBeLessThanOrEqual(100);
    expect(y).toBeLessThanOrEqual(-200);
    expect(x + width).toBeGreaterThanOrEqual(400);
    expect(y + height).toBeGreaterThanOrEqual(200);
    const svg = exportPageSvg(page);
    expect(svg.indexOf('data-node-id="frame"')).toBeLessThan(svg.indexOf('data-node-id="child"'));
    expect(svg).toContain('translate(100 100) rotate(90 50 50)');
    expect(svg).toContain('translate(-300 -200) rotate(0 10 5)');
    const html = exportPageHtml(page);
    expect(html.indexOf('data-node-id="frame"')).toBeLessThan(html.indexOf('data-node-id="child"'));
    expect(html).toContain('left:-300px;top:-200px;');
    expect(html).toContain('transform:rotate(90deg);transform-origin:center center;');
  });

  it('honors ancestor visibility and opacity and excludes invisible content from bounds', () => {
    const hidden = createNode('frame', { id: 'hidden', visible: false, x: -1000 });
    const child = createNode('text', {
      id: 'hidden-child',
      parentId: 'hidden',
      text: 'Secret child',
    });
    const transparent = createNode('rectangle', { id: 'transparent', opacity: 0, x: 1000 });
    const shown = createNode('rectangle', {
      id: 'shown',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      opacity: 0.4,
    });
    const page = pageWith(hidden, child, transparent, shown);
    expect(viewBox(exportPageSvg(page))).toEqual([10, 20, 30, 40]);
    for (const output of [exportPageSvg(page), exportPageHtml(page)]) {
      expect(output).not.toContain('hidden-child');
      expect(output).not.toContain('Secret child');
      expect(output).not.toContain('data-node-id="transparent"');
      expect(output).toContain('data-node-id="shown"');
    }
    expect(exportPageSvg(page)).toContain('opacity="0.4"');
    expect(exportPageHtml(page)).toContain('opacity:0.4;');
  });

  it('preserves inherited opacity instead of flattening it onto children', () => {
    const page = pageWith(
      createNode('frame', { id: 'frame', opacity: 0.5 }),
      createNode('rectangle', { id: 'child', parentId: 'frame', opacity: 0.25 }),
    );
    expect(exportPageSvg(page)).toMatch(
      /opacity="0\.5"[\s\S]*data-node-id="child"[\s\S]*opacity="0\.25"/,
    );
    expect(exportPageHtml(page)).toMatch(
      /opacity:0\.5;[\s\S]*data-node-id="child"[\s\S]*opacity:0\.25;/,
    );
  });

  it('exports rectangle radii, ellipses, colors, and centered borders', () => {
    const page = pageWith(
      createNode('rectangle', {
        id: 'rectangle',
        width: 80,
        height: 40,
        radius: 100,
        fill: '#12345678',
        stroke: '#aBc',
        strokeWidth: 4,
      }),
      createNode('ellipse', { id: 'ellipse', width: 90, height: 60, fill: 'transparent' }),
    );
    const svg = exportPageSvg(page);
    expect(svg).toContain(
      '<rect width="80" height="40" rx="20" fill="#12345678" stroke="#aBc" stroke-width="4"',
    );
    expect(svg).toContain('<ellipse cx="45" cy="30" rx="45" ry="30"');
    const html = exportPageHtml(page);
    expect(html).toContain('background:#12345678;border-radius:20px;');
    expect(html).toContain('border:4px solid #aBc;border-radius:22px;');
    expect(html).toContain('border-radius:50%;');
  });

  it('preserves explicit multiline text, blank lines, typography, and alignment', () => {
    const page = pageWith(
      createNode('text', {
        text: 'One\r\n\r\nThree\rFour',
        width: 200,
        fontSize: 20,
        fontFamily: 'Georgia',
        fontWeight: 700,
        textAlign: 'center',
        fill: '#456',
      }),
    );
    const svg = exportPageSvg(page);
    expect(svg).toContain(
      'font-family="Georgia" font-size="20" font-weight="700" text-anchor="middle" xml:space="preserve"',
    );
    expect(svg).toContain(
      '<tspan x="100" y="20">One</tspan><tspan x="100" y="44"></tspan><tspan x="100" y="68">Three</tspan><tspan x="100" y="92">Four</tspan>',
    );
    const html = exportPageHtml(page);
    expect(html).toContain(
      'white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden;width:100%;height:100%;tab-size:4;font-family:Georgia;font-size:20px;font-weight:700;line-height:1.2;text-align:center;color:#456;',
    );
    expect(html).toContain('One\n\nThree\nFour');
  });

  it.each([
    ['left', 'start', '0'],
    ['center', 'middle', '100'],
    ['right', 'end', '200'],
  ] as const)('maps %s alignment consistently', (textAlign, anchor, x) => {
    const page = pageWith(createNode('text', { textAlign, width: 200 }));
    expect(exportPageSvg(page)).toContain(`text-anchor="${anchor}"`);
    expect(exportPageSvg(page)).toContain(`<tspan x="${x}"`);
    expect(exportPageHtml(page)).toContain(`text-align:${textAlign};`);
  });

  it('clips overflowing SVG text to its exact node box and does not inflate canvas bounds', () => {
    const page = pageWith(
      createNode('text', {
        width: 20,
        height: 10,
        fontSize: 20,
        text: 'Long text\nSecond',
        textAlign: 'right',
        stroke: '#000',
        strokeWidth: 5,
      }),
    );
    const svg = exportPageSvg(page);
    expect(viewBox(svg)).toEqual([0, 0, 20, 10]);
    expect(svg).toContain('<clipPath id="folio-text-0"><rect width="20" height="10"/></clipPath>');
    expect(svg).toContain('clip-path="url(#folio-text-0)"');
    expect(exportPageHtml(page)).toContain('overflow:hidden;width:100%;height:100%;');
  });

  it('embeds raster images without external dependencies and gives each image a separate rounded clip', () => {
    const page = pageWith(
      createNode('image', { id: 'first', src: PNG, radius: 12, stroke: '#000', strokeWidth: 2 }),
      createNode('image', { id: 'second', src: GIF, radius: 8 }),
      createNode('image', { id: 'placeholder' }),
    );
    const svg = exportPageSvg(page);
    expect(svg).toContain(`href="${PNG}"`);
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice" clip-path="url(#folio-image-0)"');
    expect(svg).toContain('clip-path="url(#folio-image-1)"');
    expect(svg).toContain('height="160" rx="12"');
    expect(svg).toContain('data-node-id="placeholder"');
    const html = exportPageHtml(page);
    expect(html).toContain(`src="${PNG}"`);
    expect(html).toContain('object-fit:cover;');
    expect(html).toContain(
      'position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;border-radius:12px;',
    );
    expect(html.indexOf(`src="${PNG}"`)).toBeLessThan(html.indexOf('border:2px solid #000;'));
    expect(html).not.toContain('https://');
  });

  it('escapes page names, node names, text, titles, and image attribute values', () => {
    const attack = '</title><script>alert("x")</script><img src=x onerror=alert(1)> & \'quoted\'';
    const page = pageWith(
      createNode('text', { id: 'text', name: attack, text: attack }),
      createNode('image', { id: 'image', name: attack, src: PNG }),
    );
    page.name = attack;
    for (const output of [exportPageSvg(page), exportPageHtml(page)]) {
      expect(output).not.toContain('<script>');
      expect(output).not.toContain('<img src=x');
      expect(output).not.toContain('</title><script>');
      expect(output).toContain('&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
      expect(output).toContain('&amp; &#39;quoted&#39;');
      expect(output).toContain('aria-label="&lt;/title&gt;');
    }
    expect(exportPageHtml(page)).toContain('alt="&lt;/title&gt;');
  });

  it('validates exports directly so callers cannot bypass URL, CSS, or structural checks', () => {
    const maliciousPatches: Partial<DesignNode>[] = [
      { src: 'javascript:alert(1)' },
      { fill: 'url(https://evil.example)' },
      { stroke: '#fff" onload="alert(1)' },
      { fontFamily: 'Arial; background:url(https://evil.example)' },
      { width: NaN },
      { parentId: 'missing' },
      { id: 'x" onclick="bad' },
    ];
    for (const patch of maliciousPatches) {
      const page = pageWith({ ...createNode('image'), ...patch });
      expect(() => exportPageSvg(page)).toThrow(/Invalid document/);
      expect(() => exportPageHtml(page)).toThrow(/Invalid document/);
    }
  });

  it('is deterministic and leaves the page and nodes unchanged', () => {
    const page = nestedDocument().pages[0];
    const before = JSON.stringify(page);
    expect(exportPageSvg(page)).toBe(exportPageSvg(page));
    expect(exportPageHtml(page)).toBe(exportPageHtml(page));
    expect(JSON.stringify(page)).toBe(before);
  });
});
