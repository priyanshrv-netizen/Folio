import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocumentStore } from './documents.mjs';
import {
  addPage,
  createDocument,
  createNode,
  movePage,
  removePage,
  renamePage,
} from '../../src/model.ts';

describe('page-management persistence', () => {
  it('saves renamed and reordered pages, deletes a page, and restores the full undo snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'folio-pages-'));
    try {
      const store = createDocumentStore(directory);
      const original = createDocument('Page history');
      const firstId = original.activePageId;
      original.pages[0].canvasColor = '#334455';
      original.pages[0].nodes = [
        createNode('frame', { id: 'artboard', clipContent: true }),
        createNode('text', { id: 'child', parentId: 'artboard', text: 'Keep this artwork' }),
      ];
      const added = addPage(original);
      const secondId = added.activePageId;
      const reordered = movePage(renamePage(added, firstId, 'Cover'), firstId, 1);
      await store.saveDocument(reordered);
      expect(await store.loadDocument(original.id)).toEqual(reordered);
      const deleted = removePage(reordered, secondId);
      await store.saveDocument(deleted);
      const reloaded = await createDocumentStore(directory).loadDocument(original.id);
      expect(reloaded.activePageId).toBe(firstId);
      expect(reloaded.pages).toEqual([reordered.pages[1]]);
      expect((await store.listDocuments())[0].pageCount).toBe(1);
      await store.saveDocument(reordered);
      expect(await store.loadDocument(original.id)).toEqual(reordered);
      expect((await store.listDocuments())[0].pageCount).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
