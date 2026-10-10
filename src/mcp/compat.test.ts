import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createLocalMcpServer, McpBridgeError } from '../../desktop/mcp/server.mjs';
import { parseTool, ALL_TOOL_DEFINITIONS } from '../../desktop/mcp/tools.mjs';
import { createDocument, createNode, worldPosition } from '../model';
import { prepareCommand } from './commands';
import { computedCss, wildcardMatch } from './compat';
import { normalizeColor } from '../../desktop/mcp/css.mjs';
import { CommandError } from './errors';
import { SHADER_CATALOG } from '../shaders/presets';
import type { DesignDocument, DesignPage } from '../types';

vi.mock('../shaders', async () => ({
  ...(await import('../shaders/presets')),
  prepareShaderSnapshots: async () => ({}),
}));
function fixture() {
  const document = createDocument('Compatibility');
  document.pages[0].nodes = [
    createNode('frame', { id: 'board', x: 30, y: 40, width: 300, height: 200 }),
    createNode('text', {
      id: 'heading',
      parentId: 'board',
      text: 'Hello compatibility',
      width: 100,
      height: 30,
      x: 10,
      y: 12,
      fontSize: 16,
      fill: '#ccc',
    }),
    createNode('rectangle', { id: 'shape', parentId: 'board', x: 60, y: 70 }),
    createNode('frame', { id: 'destination', x: 600, y: 400, rotation: 40 }),
  ];
  return document;
}
const run = (name: string, args: Record<string, unknown>, document = fixture()) =>
  prepareCommand({ name, args: { fileId: document.id, ...args } }, document, []);

describe('observed Paper input contract compatibility', () => {
  it('pins original schema evidence and only advertises implemented helpers', () => {
    const reference = JSON.parse(
      readFileSync(
        new URL('../../desktop/mcp/fixtures/paper-cli-0.0.1.json', import.meta.url),
        'utf8',
      ),
    );
    expect(reference.tools).toHaveLength(36);
    expect(
      reference.tools.find((tool: { name: string }) => tool.name === 'write_html').inputSchema
        .required,
    ).toEqual(['html', 'targetNodeId', 'mode', 'fileId']);
    expect(ALL_TOOL_DEFINITIONS.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining([
        'open_file',
        'create_file',
        'finish_working_on_nodes',
        'create_tokens',
        'list_comment_threads',
      ]),
    );
    for (const name of ['get_fill_image', 'get_font_family_info', 'get_guide'])
      expect(reference.tools.some((tool: { name: string }) => tool.name === name)).toBe(true);
  });

  it('reads actual document metadata, root/child aliases, plain tree text, and CSS maps', async () => {
    const document = fixture();
    const info = (await run('get_basic_info', {}, document)).result.data;
    expect(info).toMatchObject({
      fileId: document.id,
      fileName: 'Compatibility',
      rootNodeId: document.activePageId,
      nodeCount: 4,
    });
    expect(info.pages).toMatchObject([{ isActive: true }]);
    expect((await run('get_children', { nodeId: 'board' })).result.data.children).toMatchObject([
      { id: 'heading', component: 'Text' },
      { id: 'shape' },
    ]);
    expect((await run('get_node_info', { nodeId: 'heading' })).result.data).toMatchObject({
      textContent: 'Hello compatibility',
      worldX: 40,
      worldY: 52,
    });
    expect((await run('get_tree_summary', { nodeId: 'board' })).result.text).toContain(
      'text "Text" (heading) 100×30',
    );
    expect(
      (await run('get_computed_styles', { nodeIds: ['heading'] })).result.data.heading,
    ).toMatchObject({ color: '#ccc', fontSize: '16px', left: '10px' });
  });

  it('creates nonoverlapping CSS artboards, changes literal styles and textContent atomically', async () => {
    let doc = fixture();
    const created = await run(
      'create_artboard',
      {
        name: 'CSS board',
        styles: { width: '390px', height: '844px', backgroundColor: 'rgb(255, 0, 0)' },
      },
      doc,
    );
    expect(created.document!.pages[0].nodes.at(-1)).toMatchObject({
      width: 390,
      height: 844,
      fill: '#ff0000',
      x: 1320,
    });
    doc = (
      await run(
        'update_styles',
        {
          updates: [
            {
              nodeIds: ['heading'],
              styles: { color: 'hsl(240, 100%, 50%)', fontSize: '28px', fontWeight: 'bold' },
            },
          ],
        },
        doc,
      )
    ).document!;
    doc = (
      await run(
        'set_text_content',
        { updates: [{ nodeId: 'heading', textContent: 'Updated' }] },
        doc,
      )
    ).document!;
    expect(doc.pages[0].nodes[1]).toMatchObject({
      fill: '#0000ff',
      fontSize: 28,
      fontWeight: 700,
      text: 'Updated',
    });
  });

  it('creates freeform CSS artboards when explicitly requested without a hidden flex layout', async () => {
    const created = await run('create_artboard', {
      name: 'Freeform',
      styles: { width: '200px', height: '100px', display: 'block' },
    });
    expect(created.document!.pages[0].nodes.at(-1)!.layout).toBeUndefined();
  });

  it('duplicates subtrees with usable descendant maps and explicit destinations', async () => {
    const doc = fixture();
    const result = await run(
      'duplicate_nodes',
      { nodes: [{ id: 'board', parentId: 'destination' }] },
      doc,
    );
    const copies = result.result.data.nodes as {
      sourceId: string;
      newId: string;
      descendantIdMap: Record<string, string>;
    }[];
    expect(copies[0].sourceId).toBe('board');
    const nodes = result.document!.pages[0].nodes;
    expect(nodes.find((node) => node.id === copies[0].newId)?.parentId).toBe('destination');
    expect(nodes.find((node) => node.id === copies[0].descendantIdMap.heading)?.text).toBe(
      'Hello compatibility',
    );
    expect(doc.pages[0].nodes).toHaveLength(4);
  });

  it('applies sibling and index moves sequentially and preserves freeform world centers under rotation', async () => {
    const doc = fixture();
    const source = doc.pages[0].nodes[1];
    const center = worldPosition(
      { ...source, x: source.x + source.width / 2, y: source.y + source.height / 2 },
      doc.pages[0].nodes,
    );
    const result = await run(
      'move_nodes',
      {
        moves: [
          { nodeId: 'heading', parentId: 'destination', index: 0 },
          { nodeId: 'shape', after: 'heading' },
        ],
      },
      doc,
    );
    const nodes = result.document!.pages[0].nodes;
    const moved = nodes.find((node) => node.id === 'heading')!;
    const newCenter = worldPosition(
      { ...moved, x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 },
      nodes,
    );
    expect(newCenter.x).toBeCloseTo(center.x);
    expect(newCenter.y).toBeCloseTo(center.y);
    expect(nodes.filter((node) => node.parentId === 'destination').map((node) => node.id)).toEqual([
      'heading',
      'shape',
    ]);
    expect(result.result.data.moves).toMatchObject([
      { parentId: 'destination', index: 0 },
      { parentId: 'destination', index: 1 },
    ]);
    const root = await run(
      'move_nodes',
      { moves: [{ nodeId: 'shape', parentId: 'root', index: 0 }] },
      result.document!,
    );
    expect(root.document!.pages[0].nodes.find((node) => node.id === 'shape')!.parentId).toBeNull();
  });

  it('finds AND-combined literal/wildcard CSS and text matches', async () => {
    const result = await run('find_nodes', {
      textValue: '*compat*',
      filters: [
        { styleName: 'color', styleValue: 'rgb(204,204,204)' },
        { styleName: 'font-*', styleValue: '16px' },
      ],
    });
    expect(result.result.data.items).toMatchObject([
      {
        id: 'heading',
        matched: [
          { textValue: 'Hello compatibility' },
          { styleName: 'color', styleValue: '#ccc' },
          { styleName: 'fontSize', styleValue: '16px' },
        ],
      },
    ]);
    expect((await run('find_nodes', { textValue: 'compat' })).result.data.total).toBe(0);
    expect(wildcardMatch('AA.b', '*a.*')).toBe(true);
    expect(wildcardMatch('anything', '(a+)+$')).toBe(false);
  });

  it.each([
    [
      'update_styles',
      {
        updates: [
          { nodeIds: ['heading'], styles: { color: '#fff' } },
          { nodeIds: ['shape'], styles: { backgroundImage: 'url(file:///private)' } },
        ],
      },
    ],
    ['update_styles', { updates: [{ nodeIds: ['shape'], styles: { display: 'garbage' } }] }],
    [
      'move_nodes',
      {
        moves: [
          { nodeId: 'shape', parentId: 'root' },
          { nodeId: 'board', parentId: 'heading' },
        ],
      },
    ],
    ['move_nodes', { moves: [{ nodeId: 'board', parentId: 'board' }] }],
    ['duplicate_nodes', { nodes: [{ id: 'shape' }, { id: 'missing' }] }],
    [
      'set_text_content',
      {
        updates: [
          { nodeId: 'heading', textContent: 'Good' },
          { nodeId: 'shape', textContent: 'Bad' },
        ],
      },
    ],
  ])('fails the whole %s compatibility batch without changing input', async (name, args) => {
    const doc = fixture();
    const before = JSON.stringify(doc);
    await expect(run(name as string, args as Record<string, unknown>, doc)).rejects.toThrow();
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('rejects stale file/page guards instead of opening or switching another document', async () => {
    await expect(run('create_artboard', { fileId: 'different', name: 'No' })).rejects.toThrow(
      'STALE_DOCUMENT',
    );
    await expect(run('get_basic_info', { pageId: 'different' })).rejects.toThrow('STALE_DOCUMENT');
  });

  it('exports actual JSX formats and only invokes animation renderer on explicit request', async () => {
    const doc = fixture();
    const inline = await run('get_jsx', { nodeId: 'heading', format: 'inline-styles' }, doc);
    const tailwind = await run('get_jsx', { nodeId: 'heading', format: 'tailwind' }, doc);
    expect(inline.result.text).toContain('"position":"absolute"');
    expect(tailwind.result.text).toContain('className="absolute"');
    const renderer = vi.fn(async (_page: DesignPage) => '<html>offline animation</html>');
    const result = await prepareCommand(
      { name: 'export', args: { format: 'animated-html', nodeId: 'board' } },
      doc,
      [],
      { animatedHtml: renderer },
    );
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(renderer.mock.calls[0][0].nodes).toHaveLength(3);
    expect(result.result.data.content).toBe('<html>offline animation</html>');
  });

  it('validates full effect catalog using the real closed shader schema while keeping six defaults', async () => {
    expect((await run('list_shader_presets', {})).result.data.presets).toHaveLength(6);
    expect((await run('list_shader_presets', { catalog: 'all' })).result.data.presets).toHaveLength(
      30,
    );
    for (const preset of SHADER_CATALOG)
      expect(
        parseTool('apply_shader', { nodeIds: ['shape'], config: preset.config }),
      ).toBeDefined();
    expect(() =>
      parseTool('apply_shader', {
        nodeIds: ['shape'],
        config: { ...SHADER_CATALOG[0].config, parameters: { arbitraryUniform: 2 } },
      }),
    ).toThrow();
  });

  it('executes observed contracts through a real initialized MCP HTTP client', async () => {
    let doc: DesignDocument = fixture();
    let commits = 0;
    const server = createLocalMcpServer({
      dispatch: async (name: string, args: unknown) => {
        try {
          const prepared = await prepareCommand({ name, args }, doc, []);
          if (prepared.document) {
            doc = prepared.document;
            commits++;
          }
          return prepared.result;
        } catch (error) {
          throw new McpBridgeError(error instanceof CommandError ? error.code : 'INTERNAL');
        }
      },
    });
    const client = new Client({ name: 'paper-contract-test', version: '1' });
    try {
      const { endpoint } = await server.enable({ port: 0 });
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint!)));
      const first = await client.listTools();
      const helpers = await client.listTools({ cursor: first.nextCursor });
      expect(helpers.tools.map((tool) => tool.name)).toContain('get_fill_image');
      const fileId = doc.id;
      const result = await client.callTool({
        name: 'set_text_content',
        arguments: { fileId, updates: [{ nodeId: 'heading', textContent: 'Protocol text' }] },
      });
      expect(result.isError).not.toBe(true);
      expect(commits).toBe(1);
      expect(doc.pages[0].nodes[1].text).toBe('Protocol text');
      const invalid = await client.callTool({
        name: 'update_styles',
        arguments: {
          fileId,
          updates: [{ nodeIds: ['heading'], styles: { color: 'url(https://evil.test)' } }],
        },
      });
      expect(invalid.isError).toBe(true);
      expect(commits).toBe(1);
    } finally {
      await client.close();
      await server.disable();
    }
  });
});

describe('literal CSS safety', () => {
  it.each([
    'var(--private)',
    'url(https://evil.test)',
    '#fff;display:none',
    'rgb(0,0,999)',
    'rgba(1,2,3,4)',
    'expression(alert(1))',
  ])('rejects %s', (value) => expect(() => normalizeColor(value)).toThrow());
  it('normalizes equivalent colors without a browser or fetching', () => {
    expect(normalizeColor('#abc')).toBe('#aabbcc');
    expect(normalizeColor('rgba(255,0,0,0.5)')).toBe('#ff000080');
    expect(normalizeColor('rgb(100% 0% 0%)')).toBe('#ff0000');
    expect(normalizeColor('hsl(120,100%,50%)')).toBe('#00ff00');
    expect(computedCss(fixture().pages[0].nodes[1]).color).toBe('#ccc');
  });
});
