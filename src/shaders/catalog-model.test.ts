import { describe, expect, it } from 'vitest';
import { createDocument, createNode, duplicateNodes, exportPageHtml, exportPageSvg, updateNodes, validateDocument } from '../model';
import { SHADER_CATALOG, createShaderConfig } from './presets';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=';

describe('full shader catalog model and static exports', () => {
  it.each(SHADER_CATALOG)('preserves $id as editable JSON and includes its static raster export', ({ config, supportsImage }) => {
    const document = createDocument();
    document.pages[0].nodes = [createNode('rectangle', { id: 'shader', shader: { ...config, ...(supportsImage ? { source: PNG } : {}) } })];
    const page = document.pages[0];
    expect(validateDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    for (const exportPage of [exportPageSvg, exportPageHtml]) {
      expect(() => exportPage(page)).toThrow(/snapshot/);
      const output = exportPage(page, { shader: PNG });
      expect(output).toContain(`data-shader-kind="${config.kind}"`);
      expect(output).toContain(PNG);
    }
  });

  it('duplicates nested parameters independently and preserves image edits across undo snapshots', () => {
    const document = createDocument();
    document.pages[0].nodes = [createNode('frame', {
      id: 'original', shader: { ...createShaderConfig('water'), source: PNG, parameters: { caustic: 0.7, layering: 0.3 } },
    })];
    const copy = duplicateNodes(document, document.activePageId, ['original']).document;
    const [original, duplicate] = copy.pages[0].nodes;
    expect(duplicate.shader).toEqual(original.shader);
    expect(duplicate.shader?.parameters).not.toBe(original.shader?.parameters);
    duplicate.shader!.parameters!.caustic = 0.2;
    expect(original.shader?.parameters?.caustic).toBe(0.7);
    const undo = JSON.stringify(document);
    const next = updateNodes(document, document.activePageId, ['original'], {
      shader: { ...createShaderConfig('water'), parameters: { caustic: 0.4 } },
    });
    expect(next.pages[0].nodes[0].shader).not.toHaveProperty('source');
    expect(validateDocument(JSON.parse(undo)).pages[0].nodes[0].shader?.source).toBe(PNG);
    expect(document.pages[0].nodes[0].shader?.parameters?.caustic).toBe(0.7);
  });
});