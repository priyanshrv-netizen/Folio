import { describe, expect, it, vi } from 'vitest';
import { createDocument, createNode } from '../model';
import { prepareCommand, exportScope } from './commands';
import type { DesignDocument } from '../types';
import { SHADER_PRESETS } from '../shaders/presets';

vi.mock('../shaders', async () => ({
  ...(await import('../shaders/presets')),
  prepareShaderSnapshots: async () => ({}),
}));

function fixture(): DesignDocument {
  const document = createDocument('MCP fixture');
  document.pages[0].nodes = [
    createNode('frame', { id: 'board-1', name: 'Board', opacity: 0.5, x: 20, y: 30 }),
    createNode('text', {
      id: 'text-1',
      name: 'Heading',
      parentId: 'board-1',
      text: 'Hello <world>',
      x: 10,
      y: 15,
    }),
    createNode('rectangle', { id: 'rect-1', name: 'Box', parentId: 'board-1' }),
  ];
  return document;
}
const run = (name: string, args: unknown, document = fixture(), selected: string[] = []) =>
  prepareCommand({ name, args }, document, selected);

describe('active-document command transactions', () => {
  it('reads scoped document, selection, children, tree, search, and resolved styles', async () => {
    const doc = fixture();
    expect((await run('get_basic_info', {}, doc)).result.data.documentId).toBe(doc.id);
    expect((await run('get_selection', {}, doc, ['text-1'])).result.data.nodes).toMatchObject([
      { id: 'text-1' },
    ]);
    expect((await run('get_node_info', { nodeId: 'board-1' }, doc)).result.data.children).toEqual([
      'text-1',
      'rect-1',
    ]);
    expect(
      (await run('get_children', { parentId: 'board-1', limit: 1 }, doc)).result.data,
    ).toMatchObject({ total: 2, nextOffset: 1 });
    expect((await run('get_tree_summary', { depth: 0 }, doc)).result.data.total).toBe(1);
    expect((await run('find_nodes', { query: 'WORLD' }, doc)).result.data.items).toMatchObject([
      { id: 'text-1' },
    ]);
    expect(
      (await run('get_computed_styles', { nodeIds: ['text-1'] }, doc)).result.data.nodes,
    ).toMatchObject([{ styles: { effectiveOpacity: 0.5, worldPosition: { x: 30, y: 45 } } }]);
  });
  it('creates artboards and same-batch parent/child nodes without mutating the input', async () => {
    const doc = fixture();
    const result = await run('create_artboard', { name: 'New' }, doc);
    expect(result.document?.pages[0].nodes).toHaveLength(4);
    expect(doc.pages[0].nodes).toHaveLength(3);
    const batch = await run(
      'create_nodes',
      {
        nodes: [
          { type: 'frame', id: 'batch-frame' },
          { type: 'text', parentId: 'batch-frame', text: 'Child' },
        ],
      },
      doc,
    );
    expect(batch.document?.pages[0].nodes.at(-1)?.parentId).toBe('batch-frame');
    expect(batch.selected).toHaveLength(2);
  });
  it.each([
    ['create_nodes', { nodes: [{ type: 'frame', id: 'board-1' }] }],
    ['create_nodes', { nodes: [{ type: 'image', src: 'https://evil.test/image.png' }] }],
    ['create_nodes', { nodes: [{ type: 'frame', id: 'bad', parentId: 'missing' }] }],
    [
      'update_styles',
      {
        updates: [
          { nodeIds: ['text-1'], styles: { fontSize: 20 } },
          { nodeIds: ['rect-1'], styles: { fontSize: 32 } },
        ],
      },
    ],
    [
      'update_styles',
      {
        updates: [
          { nodeIds: ['text-1'], styles: { fill: '#ffffff' } },
          { nodeIds: ['missing'], styles: { fill: '#000000' } },
        ],
      },
    ],
    [
      'set_text_content',
      {
        updates: [
          { nodeId: 'text-1', text: 'Good' },
          { nodeId: 'rect-1', text: 'Bad' },
        ],
      },
    ],
    ['move_nodes', { moves: [{ nodeId: 'board-1', parentId: 'rect-1' }] }],
    ['move_nodes', { moves: [{ nodeId: 'board-1', parentId: 'board-1' }] }],
    ['delete_nodes', { nodeIds: ['rect-1', 'missing'] }],
  ])('fails %s invalid batches atomically', async (name, args) => {
    const doc = fixture();
    const before = JSON.stringify(doc);
    await expect(run(name as string, args, doc)).rejects.toThrow();
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('renames, styles, edits text, reparents, duplicates subtrees and removes descendants', async () => {
    let doc = fixture();
    doc = (await run('rename_nodes', { updates: [{ nodeId: 'text-1', name: 'Title' }] }, doc))
      .document!;
    doc = (
      await run(
        'update_styles',
        { updates: [{ nodeIds: ['text-1'], styles: { fontSize: 42, fill: '#123456' } }] },
        doc,
      )
    ).document!;
    doc = (await run('set_text_content', { updates: [{ nodeId: 'text-1', text: 'Updated' }] }, doc))
      .document!;
    expect(doc.pages[0].nodes[1]).toMatchObject({
      name: 'Title',
      fontSize: 42,
      fill: '#123456',
      text: 'Updated',
    });
    const copied = await run('duplicate_nodes', { nodeIds: ['board-1', 'text-1'] }, doc);
    expect(copied.selected).toHaveLength(1);
    expect(copied.document?.pages[0].nodes).toHaveLength(6);
    doc = (
      await run(
        'move_nodes',
        { moves: [{ nodeId: 'text-1', parentId: null, x: 100, y: 120 }] },
        doc,
      )
    ).document!;
    expect(doc.pages[0].nodes[1]).toMatchObject({ parentId: null, x: 100, y: 120 });
    doc = (await run('delete_nodes', { nodeIds: ['board-1'] }, doc)).document!;
    expect(doc.pages[0].nodes.map((node) => node.id)).toEqual(['text-1']);
  });
  it('keeps page creation in the same scope, renames atomically, and rejects explicit stale scope', async () => {
    const doc = fixture();
    const result = await run('create_page', { name: 'Second' }, doc);
    expect(result.document?.activePageId).toBe(doc.activePageId);
    const next = await run(
      'rename_pages',
      { updates: [{ pageId: result.result.data.createdPageId, name: 'Changed' }] },
      result.document,
    );
    expect(next.document?.pages[1].name).toBe('Changed');
    await expect(run('get_basic_info', { documentId: 'other-document' }, doc)).rejects.toThrow(
      'STALE_DOCUMENT',
    );
    await expect(run('create_page', { pageId: 'other-page' }, doc)).rejects.toThrow(
      'STALE_DOCUMENT',
    );
  });
  it('exports only the selected subtree, escaped HTML/SVG, and valid JSX without runtime code injection', async () => {
    const doc = fixture();
    expect(exportScope(doc.pages[0], 'text-1').nodes).toHaveLength(1);
    expect(exportScope(doc.pages[0], 'text-1').nodes[0]).toMatchObject({
      parentId: null,
      x: 0,
      y: 0,
    });
    const svg = (await run('export', { format: 'svg', nodeId: 'text-1' }, doc)).result.data
      .content as string;
    expect(svg).toContain('&lt;world&gt;');
    expect(svg).not.toContain('rect-1');
    const html = (await run('export', { format: 'html', nodeId: 'text-1' }, doc)).result.data
      .content as string;
    expect(html).toContain('Hello &lt;world&gt;');
    const jsx = (await run('get_jsx', { nodeId: 'text-1' }, doc)).result.data.code as string;
    expect(jsx).toContain('{"Hello <world>"}');
    const { transformWithOxc } = await import('vite');
    await expect(transformWithOxc(jsx, 'export.jsx')).resolves.toBeDefined();
  });
  it('applies all six real shader configurations, removes fills, and rejects illegal shader hosts', async () => {
    const doc = fixture();
    expect((await run('list_shader_presets', {}, doc)).result.data.presets).toHaveLength(6);
    for (const preset of SHADER_PRESETS) {
      const applied = await run(
        'apply_shader',
        { nodeIds: ['rect-1'], config: preset.config },
        doc,
      );
      expect(applied.document?.pages[0].nodes[2].shader?.kind).toBe(preset.id);
      const removed = await run(
        'apply_shader',
        { nodeIds: ['rect-1'], config: null },
        applied.document,
      );
      expect(removed.document?.pages[0].nodes[2].shader).toBeUndefined();
    }
    await expect(
      run('apply_shader', { nodeIds: ['rect-1', 'text-1'], config: SHADER_PRESETS[0].config }, doc),
    ).rejects.toThrow('INVALID_ARGUMENT');
  });
});
