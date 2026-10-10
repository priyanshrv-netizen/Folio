import { describe, expect, it } from 'vitest';
import {
  createDocument,
  createNode,
  updateNodes,
  validateDocument,
  exportPageHtml,
  exportPageSvg,
  duplicateNodes,
} from './model';
import type { DesignNode, FrameLayout } from './types';
import { validateLayout } from '../desktop/persistence/layout.mjs';

const layout: FrameLayout = {
  direction: 'row',
  gap: 10,
  paddingTop: 20,
  paddingRight: 20,
  paddingBottom: 20,
  paddingLeft: 20,
  align: 'start',
  justify: 'start',
};
function fixture(options: Partial<FrameLayout> = {}, children: DesignNode[] = []) {
  const doc = createDocument('Layout');
  doc.pages[0].nodes = [
    createNode('frame', {
      id: 'frame',
      width: 300,
      height: 200,
      layout: { ...layout, ...options },
    }),
    createNode('rectangle', { id: 'a', parentId: 'frame', width: 50, height: 30 }),
    createNode('rectangle', { id: 'b', parentId: 'frame', width: 60, height: 40 }),
    ...children,
  ];
  return validateDocument(doc);
}

describe('persisted frame flex layout', () => {
  it('positions fixed-size children by row and recomputes after edits without changing source', () => {
    const doc = fixture();
    expect(doc.pages[0].nodes.slice(1).map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 20, y: 20 },
      { x: 80, y: 20 },
    ]);
    const next = updateNodes(doc, doc.activePageId, ['a'], { width: 80 });
    expect(next.pages[0].nodes[2].x).toBe(110);
    expect(doc.pages[0].nodes[2].x).toBe(80);
    expect(validateDocument(next)).toEqual(next);
  });
  it('supports columns, center/end alignment, and distributed spacing', () => {
    const doc = fixture({ direction: 'column', align: 'center', justify: 'space-between' });
    expect(doc.pages[0].nodes[1]).toMatchObject({ x: 125, y: 20 });
    expect(doc.pages[0].nodes[2]).toMatchObject({ x: 120, y: 140 });
    const end = fixture({ align: 'end', justify: 'end' });
    expect(end.pages[0].nodes[1]).toMatchObject({ x: 160, y: 150 });
    expect(end.pages[0].nodes[2]).toMatchObject({ x: 220, y: 140 });
  });
  it('ignores hidden children but keeps transparent and locked children in flow', () => {
    const doc = fixture({}, [
      createNode('rectangle', { id: 'hidden', parentId: 'frame', width: 500, visible: false }),
    ]);
    const changed = updateNodes(doc, doc.activePageId, ['a'], { visible: false });
    expect(changed.pages[0].nodes[2].x).toBe(20);
    const transparent = updateNodes(doc, doc.activePageId, ['a'], { opacity: 0, locked: true });
    expect(transparent.pages[0].nodes[2].x).toBe(80);
  });
  it('reflows nested children after parent cross-axis stretch', () => {
    const doc = fixture({ align: 'stretch' }, [
      createNode('frame', {
        id: 'nested',
        parentId: 'frame',
        width: 60,
        height: 40,
        layout: { ...layout, direction: 'column', justify: 'end' },
      }),
      createNode('rectangle', { id: 'leaf', parentId: 'nested', width: 15, height: 25 }),
    ]);
    expect(doc.pages[0].nodes.find((node) => node.id === 'nested')).toMatchObject({ height: 160 });
    expect(doc.pages[0].nodes.find((node) => node.id === 'leaf')).toMatchObject({ y: 115 });
  });
  it('preserves layout through duplication, JSON, and exports computed geometry', () => {
    const doc = fixture();
    const copy = duplicateNodes(doc, doc.activePageId, ['frame']);
    expect(copy.document.pages[0].nodes.find((node) => node.id === copy.ids[0])?.layout).toEqual(
      layout,
    );
    const restored = validateDocument(JSON.parse(JSON.stringify(doc)));
    expect(restored).toEqual(doc);
    expect(exportPageSvg(restored.pages[0])).toContain('translate(80 20)');
    expect(exportPageHtml(restored.pages[0])).toContain('left:80px;top:20px');
  });
  it('keeps documents without layout unchanged and clears layout without moving children', () => {
    const doc = fixture();
    const next = updateNodes(doc, doc.activePageId, ['frame'], { layout: undefined });
    expect(next.pages[0].nodes[0]).not.toHaveProperty('layout');
    expect(next.pages[0].nodes.slice(1)).toEqual(doc.pages[0].nodes.slice(1));
    expect(validateDocument(next)).toEqual(next);
  });
  it.each(['gap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'])(
    'rejects invalid %s values',
    (key) => {
      for (const value of [-1, Infinity, NaN, '12px', 100001])
        expect(() => validateLayout({ ...layout, [key]: value })).toThrow();
    },
  );
  it('rejects layouts on leaves, invalid options, and unbounded computed coordinates', () => {
    expect(() => createNode('rectangle', { layout })).toThrow(/frames/);
    for (const invalid of [{ direction: 'diagonal' }, { align: 'auto' }, { justify: 'around' }])
      expect(() => validateLayout({ ...layout, ...invalid })).toThrow();
    expect(() =>
      fixture(
        { gap: 100000 },
        Array.from({ length: 15 }, (_, i) =>
          createNode('rectangle', { id: `extra${i}`, parentId: 'frame', width: 100000 }),
        ),
      ),
    ).toThrow(/coordinate limit/);
  });
});
