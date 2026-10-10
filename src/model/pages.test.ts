import { describe, expect, it } from 'vitest';
import {
  addPage,
  createDocument,
  createNode,
  movePage,
  removePage,
  renamePage,
  validateDocument,
} from '../model';
import { createShaderConfig } from '../shaders/presets';

function fixture() {
  const document = createDocument('Pages');
  document.tokens = [{ id: 'brand', name: 'Brand', value: '#334455' }];
  document.pages = [
    {
      id: 'one',
      name: 'Page 1',
      canvasColor: '#282828',
      nodes: [
        createNode('frame', { id: 'frame', clipContent: true, fillTokenId: 'brand' }),
        createNode('rectangle', {
          id: 'child',
          parentId: 'frame',
          shader: createShaderConfig('mesh-gradient'),
        }),
      ],
    },
    { id: 'two', name: 'Page 2', nodes: [createNode('text', { id: 'text', text: 'Second page' })] },
    { id: 'three', name: 'Page 3', nodes: [] },
  ];
  document.activePageId = 'one';
  return validateDocument(document);
}

describe('page management', () => {
  it('adds a blank uniquely named page without changing previous artwork or tokens', () => {
    const original = fixture();
    const before = structuredClone(original);
    const changed = addPage(original);
    expect(changed.pages.at(-1)).toMatchObject({ name: 'Page 4', nodes: [] });
    expect(changed.activePageId).toBe(changed.pages.at(-1)!.id);
    expect(changed.pages.slice(0, 3)).toEqual(original.pages);
    expect(changed.tokens).toEqual(original.tokens);
    expect(original).toEqual(before);
  });

  it('reuses a free default name after deletion rather than duplicating a remaining name', () => {
    const changed = addPage(removePage(fixture(), 'two'));
    expect(changed.pages.map((page) => page.name)).toEqual(['Page 1', 'Page 3', 'Page 2']);
    expect(new Set(changed.pages.map((page) => page.id)).size).toBe(3);
  });

  it('checks default names case-insensitively', () => {
    const document = createDocument();
    document.pages[0].name = 'page 2';
    const first = addPage(document);
    expect(first.pages.at(-1)!.name).toBe('Page 1');
    expect(addPage(first).pages.at(-1)!.name).toBe('Page 3');
  });

  it('enforces the 100-page document limit atomically', () => {
    const document = createDocument();
    document.pages = Array.from({ length: 100 }, (_, index) => ({
      id: `page-${index}`,
      name: `Page ${index + 1}`,
      nodes: [],
    }));
    document.activePageId = 'page-0';
    const before = structuredClone(document);
    expect(() => addPage(document)).toThrow(/between 1 and 100 pages/);
    expect(document).toEqual(before);
  });

  it('renames only the requested page, preserving its ID, complete subtree, and backdrop', () => {
    const original = fixture();
    const before = structuredClone(original);
    const changed = renamePage(original, 'one', '  Landing — 日本語  ');
    expect(changed.pages[0]).toEqual({ ...original.pages[0], name: 'Landing — 日本語' });
    expect(changed.pages.slice(1)).toEqual(original.pages.slice(1));
    expect(changed.activePageId).toBe('one');
    expect(changed.tokens).toEqual(original.tokens);
    expect(original).toEqual(before);
  });

  it.each(['', '   ', 'a'.repeat(257), 'Bad\u0000name'])(
    'rejects an invalid page name: %j',
    (name) => {
      const original = fixture();
      const before = structuredClone(original);
      expect(() => renamePage(original, 'one', name)).toThrow(/name/);
      expect(original).toEqual(before);
    },
  );

  it('returns the original document for unchanged names and order so history stays clean', () => {
    const original = fixture();
    expect(renamePage(original, 'one', ' Page 1 ')).toBe(original);
    expect(movePage(original, 'two', 1)).toBe(original);
  });

  it('moves pages in either direction without switching the active page or changing artwork', () => {
    const original = fixture();
    const before = structuredClone(original);
    const last = movePage(original, 'one', 2);
    expect(last.pages.map((page) => page.id)).toEqual(['two', 'three', 'one']);
    expect(last.pages[2]).toEqual(original.pages[0]);
    expect(last.activePageId).toBe('one');
    expect(movePage(last, 'one', 0)).toEqual(original);
    expect(original).toEqual(before);
  });

  it.each([-1, 3, 1.5, NaN, Infinity])('rejects an invalid page position: %s', (index) => {
    const original = fixture();
    expect(() => movePage(original, 'one', index)).toThrow(/page position/);
    expect(original.pages.map((page) => page.id)).toEqual(['one', 'two', 'three']);
  });

  it.each(['one', 'two', 'three'])(
    'deletes active page %s with a valid adjacent fallback',
    (id) => {
      const original = { ...fixture(), activePageId: id };
      const before = structuredClone(original);
      const changed = removePage(original, id);
      expect(changed.activePageId).toBe(id === 'one' ? 'two' : id === 'two' ? 'three' : 'two');
      expect(changed.pages).toEqual(original.pages.filter((page) => page.id !== id));
      expect(changed.tokens).toEqual(original.tokens);
      expect(validateDocument(changed)).toEqual(changed);
      expect(original).toEqual(before);
    },
  );

  it('deletes an inactive page without switching away from the current page', () => {
    const changed = removePage(fixture(), 'two');
    expect(changed.activePageId).toBe('one');
    expect(changed.pages.map((page) => page.id)).toEqual(['one', 'three']);
  });

  it('refuses to delete the last page and its artwork', () => {
    const original = removePage(removePage(fixture(), 'two'), 'three');
    const before = structuredClone(original);
    expect(() => removePage(original, 'one')).toThrow(/at least one page/);
    expect(original).toEqual(before);
  });

  it('rejects stale page IDs for all targeted operations', () => {
    const document = fixture();
    expect(() => renamePage(document, 'missing', 'New name')).toThrow(/does not exist/);
    expect(() => movePage(document, 'missing', 0)).toThrow(/does not exist/);
    expect(() => removePage(document, 'missing')).toThrow(/does not exist/);
  });

  it('round-trips page changes and an earlier history snapshot without sharing nested data', () => {
    const original = fixture();
    const renamed = renamePage(original, 'one', 'Cover');
    const reordered = movePage(renamed, 'one', 2);
    const deleted = removePage(reordered, 'two');
    expect(validateDocument(JSON.parse(JSON.stringify(deleted)))).toEqual(deleted);
    expect(validateDocument(JSON.parse(JSON.stringify(original)))).toEqual(original);
    deleted.pages[1].nodes[1].shader!.colors[0] = '#ffffff';
    expect(original.pages[0].nodes[1].shader!.colors[0]).not.toBe('#ffffff');
  });
});
