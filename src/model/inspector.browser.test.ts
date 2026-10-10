import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { createDocument, createNode, exportPageSvg, validateDocument } from '../model';
import type { DesignDocument } from '../types';

let server: ViteDevServer;
let browser: Browser;
let page: Page;
const errors: string[] = [];

beforeAll(async () => {
  const fixture = `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Inspector } from '/src/Inspector.tsx';
      import { useEditor } from '/src/useEditor.ts';
      import { updateNodes, validateDocument } from '/src/model.ts';
      import { storage } from '/src/storage.ts';
      import '/src/styles.css';
      import '/src/editor-chrome.css';
      const h = React.createElement;
      let root;
      window.mountInspector = async (document) => {
        if (root) root.unmount();
        await storage.saveDocument(document);
        function Fixture() {
          const editor = useEditor();
          const [selected, setSelected] = useState(true);
          if (!editor.document) return null;
          window.inspectorDocument = editor.document;
          const page = editor.document.pages[0];
          const patch = (value) => editor.commit(updateNodes(editor.document, page.id, [page.nodes[0].id], value));
          return h('div', { className: 'app-shell', style: {display:'flex', flexDirection:'row', height:'100vh', justifyContent:'flex-end'} },
            h('main', {style:{flex:1, padding:24}},
              h('button', {onClick:editor.undo, disabled:!editor.canUndo}, 'Undo'),
              h('button', {onClick:editor.redo, disabled:!editor.canRedo}, 'Redo'),
              h('button', {onClick:() => setSelected(!selected)}, 'Toggle selection'),
              h('span', {role:'status'}, editor.status),
              editor.error && h('p', {role:'alert'}, editor.error)),
            h(Inspector, {node:selected ? page.nodes[0] : undefined, count:selected ? 1 : 0, patch,
              header:h('div', {className:'inspector-toolbar'}, h('span', {className:'local-avatar'}, 'F'), h('span', {style:{marginLeft:'auto'}}, '100%'), h('button', {className:'share-button'}, 'Share')),
              duplicate:() => {}, remove:() => {}, reorder:() => {}, showGrid:false, setShowGrid:() => {},
              onExport:() => { window.exported = true }, onShaders:() => {}, onPlayground:() => {}, onConnect:() => {}, canShadeSelection:true,
              zoom:1, canvasColor:page.canvasColor ?? '#282828', onCanvasColorChange:(canvasColor) => editor.commit({...editor.document, pages:[{...page, canvasColor}]}) }));
        }
        root = createRoot(documentRoot());
        root.render(h(Fixture));
      };
      function documentRoot() { return window.document.getElementById('test-root'); }
    `;
  server = await createServer({
    configFile: false,
    appType: 'custom',
    cacheDir: 'node_modules/.vite-inspector-tests',
    optimizeDeps: {
      entries: ['src/Inspector.tsx', 'src/useEditor.ts'],
      include: ['react', 'react-dom/client'],
    },
    plugins: [
      {
        name: 'inspector-fixture',
        resolveId(id) {
          if (id === '/__inspector_fixture.js') return '\0inspector-fixture';
        },
        load(id) {
          if (id === '\0inspector-fixture') return fixture;
        },
      },
    ],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  server.middlewares.use((request, response, next) => {
    if (request.url !== '/__inspector_test') return next();
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><html data-appearance="dark"><head><title>Inspector tests</title></head><body><div id="test-root"></div></body></html>',
    );
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.resolvedUrls!.local[0]}__inspector_test`);
  await page.addScriptTag({ type: 'module', url: '/__inspector_fixture.js' });
  await page
    .waitForFunction(() => 'mountInspector' in window, undefined, { timeout: 20000 })
    .catch((error) => {
      throw new Error(`${error.message}\n${errors.join('\n')}`);
    });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function mount() {
  const document = createDocument('Inspector');
  document.tokens = [{ id: 'accent', name: 'Accent', value: '#336699' }];
  document.pages[0].nodes = [
    createNode('frame', { id: 'frame', fillTokenId: 'accent' }),
    createNode('rectangle', { id: 'child', parentId: 'frame', width: 40, height: 30 }),
  ];
  await page.evaluate(async (document) => {
    await (
      window as unknown as { mountInspector: (document: DesignDocument) => Promise<void> }
    ).mountInspector(document);
  }, validateDocument(document));
  await page.getByLabel('Layer name', { exact: true }).waitFor();
}

async function snapshot() {
  return page.evaluate(
    () => (window as unknown as { inspectorDocument: DesignDocument }).inspectorDocument,
  );
}

async function commitNumber(label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press('Enter');
}

describe('compact Inspector behavior', () => {
  it('rasterizes exported outer and inner shadows, clipping and filters without external resources', async () => {
    const document = createDocument();
    document.pages[0].nodes = [
      createNode('frame', {
        id: 'frame',
        width: 100,
        height: 80,
        fill: '#ffffff',
        clipContent: true,
        shadow: { color: '#ff0000', x: 10, y: 0, blur: 0, spread: 0 },
        innerShadow: { color: '#0000ff', x: 10, y: 0, blur: 0, spread: 0 },
        filters: { blur: 0, brightness: 0.5, contrast: 1, saturation: 1 },
      }),
      createNode('rectangle', {
        id: 'child',
        parentId: 'frame',
        x: 95,
        y: 0,
        width: 40,
        height: 80,
        fill: '#00ff00',
      }),
    ];
    const svg = exportPageSvg(document.pages[0]);
    const result = await page.evaluate(async (svg) => {
      const image = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        image.src = url;
        await image.decode();
        const canvas = window.document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          pixels: [5, 50, 97, 105].map((x) => [...context.getImageData(x, 40, 1, 1).data]),
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    }, svg);
    expect(result.width).toBe(110);
    expect(result.pixels).toEqual([
      [0, 0, 128, 255],
      [128, 128, 128, 255],
      [0, 128, 0, 255],
      [128, 0, 0, 255],
    ]);
  });

  it('renders the source-ordered panels with working flex, sizing, clipping and effects', async () => {
    await mount();
    expect(await page.locator('.inspector details > summary').allTextContents()).toEqual([
      'Layout',
      'Radius',
      'Blending',
      'Fill',
      'Outline',
      'Shadow',
      'Inner shadow',
      'Filters',
      'Arrange',
      'Export',
    ]);
    expect(await page.locator('.panel-tabs').count()).toBe(0);
    expect(
      await page.locator('.inspector').evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        font: getComputedStyle(element).fontSize,
      })),
    ).toEqual({ width: 280, font: '12px' });
    expect(
      await page
        .getByLabel('X', { exact: true })
        .locator('..')
        .evaluate((element) => element.getBoundingClientRect().height),
    ).toBe(24);
    expect(
      await page
        .getByLabel('X', { exact: true })
        .locator('..')
        .locator('span')
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe('12px');
    const geometry = await page
      .locator('.geometry-grid .number-field')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
    expect(new Set(geometry).size).toBe(1);
    await page.getByRole('button', { name: 'Add flex layout', exact: true }).click();
    expect(
      await page
        .getByRole('group', { name: 'Flex alignment', exact: true })
        .getByRole('button')
        .count(),
    ).toBe(9);
    await page.getByRole('button', { name: 'Vertical layout', exact: true }).click();
    await page.getByRole('button', { name: 'Align bottom right', exact: true }).click();
    await commitNumber('Gap', '12');
    await commitNumber('Padding left', '24');
    await page.getByLabel('Width sizing', { exact: true }).selectOption('fit');
    await page.getByLabel('Height sizing', { exact: true }).selectOption('fit');
    await page.getByLabel('Clip content', { exact: true }).check();
    await page.getByLabel('Blend mode', { exact: true }).selectOption('multiply');
    await page.getByRole('button', { name: 'Add shadow', exact: true }).click();
    await commitNumber('Shadow Blur', '18');
    await page.getByRole('button', { name: 'Add inner shadow', exact: true }).click();
    await page.getByRole('button', { name: 'Add filters', exact: true }).click();
    await commitNumber('Brightness', '125');
    expect((await snapshot()).pages[0].nodes[0]).toMatchObject({
      width: 80,
      height: 62,
      widthMode: 'fit',
      heightMode: 'fit',
      clipContent: true,
      blendMode: 'multiply',
      shadow: { blur: 18 },
      innerShadow: { blur: 4 },
      filters: { brightness: 1.25 },
      layout: { direction: 'column', align: 'end', justify: 'end', gap: 12, paddingLeft: 24 },
    });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await snapshot()).pages[0].nodes[0].filters?.brightness).toBe(1);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    expect((await snapshot()).pages[0].nodes[0].filters?.brightness).toBe(1.25);
    await page.getByRole('button', { name: 'Remove flex layout', exact: true }).click();
    expect((await snapshot()).pages[0].nodes[0].widthMode).toBe('fixed');
    expect((await snapshot()).pages[0].nodes[0].width).toBe(80);
    expect(await page.getByRole('alert').count()).toBe(0);
  }, 30_000);

  it('detaches manual fill tokens, keeps collapsible accessible controls and exports available', async () => {
    await mount();
    await page.getByLabel('Fill hex', { exact: true }).fill('#fedcba');
    await page.getByLabel('Fill hex', { exact: true }).press('Enter');
    expect((await snapshot()).pages[0].nodes[0]).not.toHaveProperty('fillTokenId');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await snapshot()).pages[0].nodes[0]).toMatchObject({
      fill: '#336699',
      fillTokenId: 'accent',
    });
    await page.getByRole('button', { name: 'Add flex layout', exact: true }).click();
    await page.getByLabel('Layout alignment', { exact: true }).selectOption('center');
    await page.getByLabel('Layout distribution', { exact: true }).selectOption('space-between');
    const layoutSummary = page
      .locator('.inspector details > summary')
      .filter({ hasText: /^Layout$/ });
    await layoutSummary.click();
    expect(await page.getByLabel('Gap', { exact: true }).isVisible()).toBe(false);
    await layoutSummary.click();
    expect(await page.getByLabel('Gap', { exact: true }).isVisible()).toBe(true);
    await page.getByLabel('Layer name', { exact: true }).fill('Renamed artboard');
    await page.getByLabel('Layer name', { exact: true }).press('Enter');
    expect((await snapshot()).pages[0].nodes[0].name).toBe('Renamed artboard');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { exported: boolean }).exported)).toBe(
      true,
    );
  }, 30_000);

  it('shows only truthful Page and MCP controls and saves real page color with undo', async () => {
    await mount();
    await page.getByRole('button', { name: 'Toggle selection', exact: true }).click();
    expect(await page.locator('.inspector .section-heading').allTextContents()).toEqual([
      'Page',
      'MCP',
    ]);
    expect(
      await page.getByRole('button', { name: 'Connect your agent', exact: true }).isVisible(),
    ).toBe(true);
    expect(
      await page
        .getByRole('button', { name: 'Connect your agent', exact: true })
        .evaluate((element) => element.getBoundingClientRect().height),
    ).toBe(24);
    expect(
      await page.getByRole('button', { name: 'Connect more agents', exact: true }).count(),
    ).toBe(0);
    expect(await page.locator('.material-invitation, .shortcuts, .inspector-footer').count()).toBe(
      0,
    );
    await page.getByLabel('Page hex', { exact: true }).fill('#123456');
    await page.getByLabel('Page hex', { exact: true }).press('Enter');
    expect((await snapshot()).pages[0].canvasColor).toBe('#123456');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await snapshot()).pages[0]).not.toHaveProperty('canvasColor');
    for (const theme of ['dark', 'light']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.appearance = theme;
      }, theme);
      const color = await page.locator('.inspector').evaluate((element) => {
        const probe = document.createElement('span');
        probe.style.background = 'var(--editor-panel)';
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { background: getComputedStyle(element).backgroundColor, expected };
      });
      expect(color.background).toBe(color.expected);
    }
    expect(errors).toEqual([]);
    if (process.env.FOLIO_INSPECTOR_PROOF_DIR) {
      await mkdir(process.env.FOLIO_INSPECTOR_PROOF_DIR, { recursive: true });
      await page.evaluate(() => {
        document.documentElement.dataset.appearance = 'dark';
      });
      await page
        .locator('.inspector')
        .screenshot({ path: `${process.env.FOLIO_INSPECTOR_PROOF_DIR}/inspector-page.png` });
      await page.getByRole('button', { name: 'Toggle selection', exact: true }).click();
      await page.getByRole('button', { name: 'Add flex layout', exact: true }).click();
      await page
        .locator('.inspector')
        .screenshot({ path: `${process.env.FOLIO_INSPECTOR_PROOF_DIR}/inspector-selected.png` });
    }
  }, 30_000);
});
