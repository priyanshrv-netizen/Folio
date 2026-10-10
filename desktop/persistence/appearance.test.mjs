import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocumentStore } from './documents.mjs';
import { createDocument, createNode, updateNodes } from '../../src/model.ts';
import {
  DEFAULT_SHADOW,
  DEFAULT_INNER_SHADOW,
  DEFAULT_FILTERS,
} from '../../src/model/appearance.ts';

describe('appearance persistence', () => {
  it('saves and reloads page colors, fitted geometry, token references and all effects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'folio-appearance-'));
    try {
      const store = createDocumentStore(directory);
      const document = createDocument('Persisted appearance');
      document.tokens = [{ id: 'accent', name: 'Accent', value: '#112233' }];
      document.pages[0].canvasColor = '#282828';
      document.pages[0].nodes = [
        createNode('frame', {
          id: 'frame',
          fillTokenId: 'accent',
          clipContent: true,
          blendMode: 'overlay',
          shadow: DEFAULT_SHADOW,
          innerShadow: DEFAULT_INNER_SHADOW,
          filters: { ...DEFAULT_FILTERS, brightness: 1.5 },
          widthMode: 'fit',
          heightMode: 'fit',
          layout: {
            direction: 'row',
            gap: 0,
            paddingTop: 8,
            paddingRight: 8,
            paddingBottom: 8,
            paddingLeft: 8,
            align: 'start',
            justify: 'start',
          },
        }),
        createNode('rectangle', { id: 'child', parentId: 'frame', width: 40, height: 20 }),
      ];
      await store.saveDocument(document);
      const loaded = await store.loadDocument(document.id);
      expect(loaded.pages[0].canvasColor).toBe('#282828');
      expect(loaded.tokens).toEqual(document.tokens);
      expect(loaded.pages[0].nodes[0]).toMatchObject({
        width: 56,
        height: 36,
        fill: '#112233',
        fillTokenId: 'accent',
        clipContent: true,
        blendMode: 'overlay',
        widthMode: 'fit',
        heightMode: 'fit',
        shadow: DEFAULT_SHADOW,
        innerShadow: DEFAULT_INNER_SHADOW,
        filters: { ...DEFAULT_FILTERS, brightness: 1.5 },
      });
      const manual = updateNodes(loaded, loaded.activePageId, ['frame'], {
        fill: '#abcdef',
        shadow: undefined,
        innerShadow: undefined,
        filters: undefined,
        layout: undefined,
      });
      await store.saveDocument(manual);
      const reloaded = await store.loadDocument(document.id);
      expect(reloaded).toEqual(manual);
      expect(reloaded.pages[0].nodes[0]).not.toHaveProperty('fillTokenId');
      expect(reloaded.pages[0].nodes[0]).not.toHaveProperty('widthMode');
      await expect(
        store.saveDocument({
          ...manual,
          pages: [{ ...manual.pages[0], canvasColor: 'url(https://example.test)' }],
        }),
      ).rejects.toThrow(/canvasColor/);
      expect(await store.loadDocument(document.id)).toEqual(manual);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
