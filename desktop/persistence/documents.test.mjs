import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocumentStore } from './documents.mjs';
import {
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  validateDocument,
  validateNode,
  validatePage,
  validateBase64,
} from './validation.mjs';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const node = (overrides = {}) => ({
  id: 'node-1',
  type: 'rectangle',
  name: 'Rectangle',
  parentId: null,
  x: 0,
  y: 0,
  width: 200,
  height: 160,
  rotation: 0,
  fill: '#b8bcf5',
  stroke: 'transparent',
  strokeWidth: 0,
  radius: 0,
  opacity: 1,
  visible: true,
  locked: false,
  ...overrides,
});
const document = (overrides = {}) => ({
  schemaVersion: 1,
  id: 'document-1',
  name: 'Untitled',
  pages: [{ id: 'page-1', name: 'Page 1', nodes: [node()] }],
  activePageId: 'page-1',
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...overrides,
});

describe('document validation', () => {
  it('accepts model defaults, canonicalizes objects and strips unknown fields', () => {
    const original = document({ unknown: 'discarded' });
    original.pages[0].nodes[0].extra = 'discarded';
    const clean = validateDocument(original);
    expect(clean).toEqual(document());
    expect(clean).not.toBe(original);
    expect(validateNode(node({ type: 'image' }))).not.toHaveProperty('src');
    expect(
      validateNode(
        node({
          type: 'text',
          text: '',
          fontFamily: 'Inter',
          fontSize: 32,
          fontWeight: 400,
          textAlign: 'left',
        }),
      ).text,
    ).toBe('');
  });

  it.each([
    null,
    [],
    {},
    'hello',
    { ...document(), schemaVersion: 2 },
    { ...document(), id: '../escape' },
    { ...document(), activePageId: 'missing' },
    { ...document(), createdAt: '2026-02-30T00:00:00.000Z' },
    { ...document(), pages: [] },
    { ...document(), name: '\u0000' },
  ])('rejects malformed documents %j', (value) => {
    expect(() => validateDocument(value)).toThrow();
  });

  it.each([
    { x: NaN },
    { y: Infinity },
    { width: 0 },
    { height: -1 },
    { rotation: 1000 },
    { opacity: 2 },
    { locked: 1 },
    { fill: 'url(https://example.test)' },
    { fontFamily: 'bad; color:red' },
    { parentId: 'missing' },
    { src: 'https://example.test/a.png' },
    { src: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { src: `data:image/jpeg;base64,${png}` },
    { src: 'data:image/png;base64,bm90LWEtcG5n' },
  ])('rejects unsafe node fields %j', (fields) => {
    const value = document();
    value.pages[0].nodes = [node(fields)];
    expect(() => validateDocument(value)).toThrow();
  });

  it('accepts embedded raster data and rejects noncanonical base64', () => {
    expect(validateNode(node({ src: `data:image/png;base64,${png}` })).src).toContain(png);
    expect(() => validateBase64('YQ==')).not.toThrow();
    expect(() => validateBase64('YR==')).toThrow();
    expect(() => validateBase64('YWE=')).not.toThrow();
    expect(() => validateBase64('YWF=')).toThrow();
    expect(() => validateBase64('AAAA', 2)).toThrow();
  });

  it('enforces the 10 MiB raster and 32 MiB document limits', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    const raster = Buffer.alloc(6 * 1024 * 1024);
    Buffer.from(png, 'base64').copy(raster);
    expect(
      validateNode(node({ src: `data:image/png;base64,${raster.toString('base64')}` })).src,
    ).toBeTruthy();
    expect(() => validateDocument(document({ unknown: 'x'.repeat(MAX_DOCUMENT_BYTES) }))).toThrow(
      /32 MiB/,
    );
  });

  it('rejects duplicate IDs, cross-page parenting, cycles and excessive nesting', () => {
    expect(() => validatePage({ id: 'page', name: 'Page', nodes: [node(), node()] })).toThrow(
      /duplicates/,
    );
    expect(() =>
      validatePage({
        id: 'page',
        name: 'Page',
        nodes: [node({ type: 'frame', parentId: 'node-1' })],
      }),
    ).toThrow(/cycle/);
    const deep = Array.from({ length: 101 }, (_, index) =>
      node({
        id: `n${index}`,
        type: 'frame',
        parentId: index ? `n${index - 1}` : null,
      }),
    );
    expect(() => validatePage({ id: 'page', name: 'Page', nodes: deep })).toThrow(/nesting/);
    expect(
      validatePage({ id: 'page', name: 'Page', nodes: deep.slice(0, 100) }).nodes,
    ).toHaveLength(100);
    expect(() =>
      validateDocument(
        document({
          pages: [
            { id: 'page-1', name: 'Page 1', nodes: [node({ type: 'frame' })] },
            { id: 'page-2', name: 'Page 2', nodes: [node({ id: 'node-2', parentId: 'node-1' })] },
          ],
        }),
      ),
    ).toThrow(/same page/);
  });

  it('rejects nonplain and circular inputs', () => {
    expect(() => validateDocument(Object.assign(new Date(), document()))).toThrow();
    const cyclic = document();
    cyclic.self = cyclic;
    expect(() => validateDocument(cyclic)).toThrow(/serializable/);
  });
});

describe('local document persistence', () => {
  let directory;
  let store;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'folio-documents-'));
    store = createDocumentStore(directory);
  });
  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('starts empty, roundtrips a document, and produces a summary', async () => {
    expect(await store.listDocuments()).toEqual([]);
    expect(await store.saveDocument(document())).toBeUndefined();
    expect(await store.loadDocument('document-1')).toEqual(document());
    expect(await store.listDocuments()).toEqual([
      { id: 'document-1', name: 'Untitled', updatedAt: document().updatedAt, pageCount: 1 },
    ]);
    expect(await readdir(join(directory, 'documents'))).toHaveLength(1);
  });

  it('serializes overlapping writes and reads, without leftover temporary files', async () => {
    const writes = Array.from({ length: 15 }, (_, index) =>
      store.saveDocument(document({ name: `Edit ${index}` })),
    );
    const pending = store.loadDocument('document-1');
    await Promise.all(writes);
    await store.flush();
    expect((await pending).name).toBe('Edit 14');
    expect((await store.loadDocument('document-1')).name).toBe('Edit 14');
    expect(
      (await readdir(join(directory, 'documents'))).every((file) => file.endsWith('.folio.json')),
    ).toBe(true);
  });

  it('snapshots inputs before writes and leaves valid data after rejected input', async () => {
    const input = document();
    const saving = store.saveDocument(input);
    input.name = 'mutated';
    await saving;
    await expect(store.saveDocument(document({ pages: [] }))).rejects.toThrow();
    expect((await store.loadDocument('document-1')).name).toBe('Untitled');
  });

  it.each(['../outside', 'a/b', 'a\\b', 'a:b', '.', '', 'x'.repeat(129)])(
    'rejects unsafe path ID %s',
    async (id) => {
      await expect(store.loadDocument(id)).rejects.toThrow();
      await expect(store.saveDocument(document({ id }))).rejects.toThrow();
    },
  );

  it('keeps case-distinct and Windows reserved IDs safe via hashed filenames', async () => {
    for (const id of ['CON', 'con', 'document', 'Document'])
      await store.saveDocument(document({ id, name: id }));
    expect(await readdir(join(directory, 'documents'))).toHaveLength(4);
    for (const id of ['CON', 'con', 'document', 'Document'])
      expect((await store.loadDocument(id)).id).toBe(id);
  });

  it('ignores corrupt, unrelated and mismatched files, but rejects loading them', async () => {
    await store.saveDocument(document());
    const files = await readdir(join(directory, 'documents'));
    const path = join(directory, 'documents', files[0]);
    await writeFile(path, '{"malformed":');
    await writeFile(join(directory, 'documents', 'other.json'), JSON.stringify(document()));
    await expect(store.loadDocument('document-1')).rejects.toThrow();
    expect(await store.listDocuments()).toEqual([]);
    await writeFile(path, JSON.stringify(document({ id: 'wrong-id' })));
    await expect(store.loadDocument('document-1')).rejects.toThrow(/does not match/);
    expect(await store.listDocuments()).toEqual([]);
    expect(await readFile(path, 'utf8')).toContain('wrong-id');
  });

  it('recovers its write queue after a filesystem failure', async () => {
    await writeFile(join(directory, 'documents'), 'not a directory');
    await expect(store.saveDocument(document())).rejects.toThrow();
    await rm(join(directory, 'documents'));
    await mkdir(join(directory, 'documents'));
    await store.saveDocument(document());
    expect((await store.loadDocument('document-1')).id).toBe('document-1');
  });
});
