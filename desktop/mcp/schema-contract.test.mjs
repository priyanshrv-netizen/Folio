import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { parseTool } from './tools.mjs';

const reference = JSON.parse(
  readFileSync(new URL('./fixtures/paper-cli-0.0.1.json', import.meta.url), 'utf8'),
);
const validator = new AjvJsonSchemaValidator();
const fileId = 'folio-document';
const samples = [
  ['get_basic_info', { fileId, pageId: 'page-1' }],
  ['get_selection', { fileId }],
  ['get_node_info', { fileId, nodeId: 'node-1' }],
  ['get_children', { fileId, nodeId: 'node-1' }],
  ['get_tree_summary', { fileId, nodeId: 'node-1', depth: 3 }],
  ['get_computed_styles', { fileId, nodeIds: ['node-1'] }],
  ['get_screenshot', { fileId, nodeId: 'node-1', scale: 2 }],
  ['get_jsx', { fileId, nodeId: 'node-1', format: 'inline-styles' }],
  [
    'find_nodes',
    {
      fileId,
      nodeId: 'node-1',
      textValue: '*hello*',
      filters: [{ styleName: 'color', styleValue: '#fff' }],
    },
  ],
  [
    'create_artboard',
    {
      fileId,
      name: 'Desktop',
      styles: {
        width: '1440px',
        height: '900px',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px',
        backgroundColor: '#f5f5f5',
      },
    },
  ],
  [
    'write_html',
    {
      fileId,
      html: '<p layer-name="Title">Hello</p>',
      targetNodeId: 'node-1',
      mode: 'insert-children',
    },
  ],
  ['write_html', { fileId, html: '<p>Replacement</p>', targetNodeId: 'node-1', mode: 'replace' }],
  ['set_text_content', { fileId, updates: [{ nodeId: 'node-1', textContent: 'Hello' }] }],
  ['rename_nodes', { fileId, updates: [{ nodeId: 'node-1', name: 'Renamed' }] }],
  [
    'update_styles',
    {
      fileId,
      updates: [{ nodeIds: ['node-1'], styles: { backgroundColor: '#fff', width: '300px' } }],
    },
  ],
  ['duplicate_nodes', { fileId, nodes: [{ id: 'node-1', parentId: 'frame-2' }] }],
  [
    'move_nodes',
    {
      fileId,
      moves: [
        { nodeId: 'node-1', before: 'node-2' },
        { nodeId: 'node-2', after: 'node-1' },
        { nodeId: 'node-3', parentId: 'root', index: 0 },
      ],
    },
  ],
  ['delete_nodes', { fileId, nodeIds: ['node-1'] }],
  ['create_page', { fileId, name: 'Page 2' }],
  ['rename_pages', { fileId, updates: [{ pageId: 'page-1', name: 'Home' }] }],
  ['export', { fileId, type: 'image', nodes: { 'node-1': [{ format: 'png', scale: '2x' }] } }],
  ['get_fill_image', { fileId, nodeId: 'node-1' }],
  ['get_font_family_info', { familyNames: ['Inter', 'Arial'] }],
  ['get_guide', { topic: 'paper-mcp-instructions' }],
];

describe('independently captured Paper CLI schemas', () => {
  it.each(samples)(
    'accepts observed %s inputs in both original JSON Schema and Folio',
    (name, input) => {
      const schema = reference.tools.find((tool) => tool.name === name).inputSchema;
      const check = validator.getValidator(schema);
      expect(check(input)).toMatchObject({ valid: true });
      expect(parseTool(name, input).name).toBe(name);
    },
  );
  it('records that exact output contracts were not supplied by Paper', () => {
    expect(reference.server).toEqual({ name: 'paper-desktop', version: '0.0.1' });
    expect(reference.tools.every((tool) => tool.outputSchema === undefined)).toBe(true);
  });
});
