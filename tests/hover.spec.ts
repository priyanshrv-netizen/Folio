import { expect, test, type Locator, type Page } from '@playwright/test';
import type { DesignDocument, DesignNode } from '../src/types';
import type { Tool } from '../src/Canvas';

function node(id: string, overrides: Partial<DesignNode> = {}): DesignNode {
  return {
    id,
    name: id,
    type: 'rectangle',
    parentId: null,
    x: 0,
    y: 0,
    width: 160,
    height: 90,
    rotation: 0,
    fill: '#e6eaf2',
    stroke: 'transparent',
    strokeWidth: 0,
    radius: 0,
    opacity: 1,
    visible: true,
    locked: false,
    ...overrides,
  };
}

function fixture(): DesignDocument {
  return {
    schemaVersion: 1,
    id: 'hover-fixture',
    name: 'Hover geometry',
    activePageId: 'page-one',
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    pages: [
      {
        id: 'page-one',
        name: 'Page one',
        nodes: [
          node('artboard', { type: 'frame', width: 640, height: 460, rotation: 17, fill: '#fff' }),
          node('container', {
            type: 'frame',
            parentId: 'artboard',
            x: 90,
            y: 85,
            width: 320,
            height: 250,
            rotation: -31,
            fill: '#f4f6f9',
          }),
          node('text', {
            type: 'text',
            parentId: 'container',
            x: 35,
            y: 35,
            width: 190,
            height: 75,
            rotation: 23,
            text: 'The whole block',
            fontSize: 20,
            fontFamily: 'Arial',
            fontWeight: 400,
            fill: '#172033',
          }),
          node('sibling', { parentId: 'container', x: 35, y: 160, width: 80, height: 50 }),
          node('locked-parent', {
            type: 'frame',
            parentId: 'artboard',
            x: 480,
            y: 95,
            width: 100,
            height: 130,
            locked: true,
          }),
          node('locked-child', { parentId: 'locked-parent', x: 20, y: 20, width: 50, height: 50 }),
          node('hidden-parent', {
            type: 'frame',
            parentId: 'artboard',
            x: 480,
            y: 300,
            width: 100,
            height: 110,
            visible: false,
          }),
          node('hidden-child', { parentId: 'hidden-parent', x: 20, y: 20, width: 50, height: 50 }),
        ],
      },
      { id: 'page-two', name: 'Page two', nodes: [node('other-page')] },
    ],
  };
}

async function openCanvas(page: Page, document = fixture()) {
  await page.goto('/tests/canvas-harness.html');
  await page.waitForFunction(() => Boolean(window.canvasHarness));
  await page.evaluate((document) => window.canvasHarness.update({ document }), document);
  await expect(page.getByTestId('node-artboard')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.canvasHarness.read().view.zoom)).toBe(1);
}

async function center(page: Page, id: string) {
  const box = (await page.getByTestId(`node-${id}`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function hoverNode(page: Page, id: string) {
  const point = await center(page, id);
  await page.mouse.move(point.x, point.y);
}

async function sameBounds(outline: Locator, artwork: Locator) {
  const actual = (await outline.boundingBox())!;
  const expected = (await artwork.boundingBox())!;
  for (const property of ['x', 'y', 'width', 'height'] as const)
    expect(actual[property]).toBeCloseTo(expected[property], 1);
}

test('DOM hover tracks the deepest rotated block without selection, commits, or document mutations', async ({
  page,
}) => {
  await openCanvas(page);
  const original = await page.evaluate(() => window.canvasHarness.read());
  await hoverNode(page, 'text');
  const hover = page.locator('[data-hover-id="text"]');
  await expect(hover).toBeVisible();
  await sameBounds(hover, page.getByTestId('node-text'));
  await expect(hover).toHaveCSS('outline-color', 'rgb(77, 148, 255)');
  await expect(hover).toHaveCSS('outline-width', '1px');
  await expect(hover).toHaveCSS('pointer-events', 'none');
  const point = await center(page, 'text');
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId,
      point,
    ),
  ).toBe('text');
  await hoverNode(page, 'sibling');
  await expect(page.locator('[data-hover-id]')).toHaveAttribute('data-hover-id', 'sibling');
  await sameBounds(page.locator('[data-hover-id]'), page.getByTestId('node-sibling'));
  const after = await page.evaluate(() => window.canvasHarness.read());
  expect(after.document).toEqual(original.document);
  expect(after.selected).toEqual(original.selected);
  expect(after.commits).toBe(0);
  expect(after.selectionChanges).toBe(0);
  await expect(page.locator('[data-selection-id]')).toHaveCount(0);
});

test('shared layer hover and selection use identical nested bounds and immediate dashed children', async ({
  page,
}) => {
  await openCanvas(page);
  await page.evaluate(() => window.canvasHarness.update({ hovered: 'container' }));
  const hover = page.locator('[data-hover-id="container"]');
  await expect(hover).toBeVisible();
  await sameBounds(hover, page.getByTestId('node-container'));
  await expect(page.locator('[data-child-outline-id]')).toHaveCount(2);
  for (const id of ['text', 'sibling']) {
    const child = page.locator(`[data-child-outline-id="${id}"]`);
    await expect(child).toHaveCSS('outline-style', 'dashed');
    await sameBounds(child, page.getByTestId(`node-${id}`));
  }
  const hoverBounds = await hover.boundingBox();
  await page.evaluate(() =>
    window.canvasHarness.update({ hovered: null, selected: ['container'] }),
  );
  await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  expect(await page.locator('[data-selection-id="container"]').boundingBox()).toEqual(hoverBounds);
  await expect(page.locator('[data-child-outline-id]')).toHaveCount(2);
  await expect(page.locator('.resize-handle')).toHaveCount(4);
  await page.evaluate(() => window.canvasHarness.update({ selected: [], hovered: 'artboard' }));
  await expect(page.locator('[data-child-outline-id]')).toHaveCount(1);
  await expect(page.locator('[data-child-outline-id]')).toHaveAttribute(
    'data-child-outline-id',
    'container',
  );
});

test('hover clears on leave, Space, hand, drawing, gestures, and text editing', async ({
  page,
}) => {
  await openCanvas(page);
  await hoverNode(page, 'text');
  await expect(page.locator('[data-hover-id]')).toHaveCount(1);
  await page.mouse.move(8, 8);
  await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  await hoverNode(page, 'text');
  await page.keyboard.down('Space');
  await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  await hoverNode(page, 'sibling');
  await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  await page.keyboard.up('Space');
  for (const tool of ['hand', 'rectangle'] as Tool[]) {
    await page.evaluate((tool) => window.canvasHarness.update({ tool, hovered: 'text' }), tool);
    await hoverNode(page, 'text');
    await expect(page.locator('[data-hover-id]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.canvasHarness.read().hovered)).toBe(null);
  }
  await page.evaluate(() => window.canvasHarness.update({ tool: 'select' }));
  await hoverNode(page, 'text');
  await expect(page.locator('[data-hover-id]')).toHaveCount(1);
  await page.mouse.down();
  await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  await page.mouse.up();
  expect(await page.evaluate(() => window.canvasHarness.read().commits)).toBe(0);
  await page.mouse.dblclick((await center(page, 'text')).x, (await center(page, 'text')).y);
  await expect(page.getByRole('textbox', { name: 'Edit text on canvas' })).toBeVisible();
  await hoverNode(page, 'sibling');
  await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  await page.evaluate(() => window.canvasHarness.update({ hovered: 'container' }));
  await expect.poll(() => page.evaluate(() => window.canvasHarness.read().hovered)).toBe(null);
  await expect(page.locator('.resize-handle, .selection-dimensions')).toHaveCount(0);
});

test('hidden and locked ancestry, deleted nodes, page switches, and document replacements clear shared hover', async ({
  page,
}) => {
  await openCanvas(page);
  await hoverNode(page, 'text');
  await hoverNode(page, 'locked-child');
  await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  for (const id of ['locked-parent', 'locked-child', 'hidden-parent', 'hidden-child', 'missing']) {
    await page.evaluate((hovered) => window.canvasHarness.update({ hovered }), id);
    await expect.poll(() => page.evaluate(() => window.canvasHarness.read().hovered)).toBe(null);
    await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  }
  for (const change of ['locked', 'hidden', 'deleted', 'page', 'document']) {
    await page.evaluate((document) => window.canvasHarness.update({ document }), fixture());
    await page.evaluate(() => window.canvasHarness.update({ hovered: 'text' }));
    await expect(page.locator('[data-hover-id="text"]')).toBeVisible();
    await page.evaluate((change) => {
      const document = structuredClone(window.canvasHarness.read().document);
      if (change === 'page') document.activePageId = 'page-two';
      else if (change === 'document') document.id = 'replacement';
      else if (change === 'deleted')
        document.pages[0].nodes = document.pages[0].nodes.filter((node) => node.id !== 'text');
      else {
        const parent = document.pages[0].nodes.find((node) => node.id === 'container')!;
        if (change === 'locked') parent.locked = true;
        else parent.visible = false;
      }
      window.canvasHarness.update({ document });
    }, change);
    await expect.poll(() => page.evaluate(() => window.canvasHarness.read().hovered)).toBe(null);
    await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  }
});

test('selection dimensions, square handles, and blue strokes stay screen-sized through zoom', async ({
  page,
}, testInfo) => {
  await openCanvas(page);
  await page.evaluate(() => window.canvasHarness.update({ selected: ['container'] }));
  const badge = page.locator('[data-dimensions-id="container"]');
  await expect(badge).toHaveText('320 × 250');
  const initialBadge = (await badge.boundingBox())!;
  const originalView = await page.evaluate(() => window.canvasHarness.read().view);
  const viewport = (await page.getByTestId('canvas').boundingBox())!;
  const point = await center(page, 'container');
  const centerX = (point.x - viewport.x - originalView.x) / originalView.zoom;
  const centerY = (point.y - viewport.y - originalView.y) / originalView.zoom;
  for (const zoom of [0.1, 0.5, 1, 2, 4]) {
    await page.evaluate(({ zoom, x, y }) => window.canvasHarness.update({ view: { zoom, x, y } }), {
      zoom,
      x: viewport.width / 2 - centerX * zoom,
      y: viewport.height / 2 - centerY * zoom,
    });
    const selection = page.locator('[data-selection-id="container"]');
    await sameBounds(selection, page.getByTestId('node-container'));
    const selectionBox = (await selection.boundingBox())!;
    const badgeBox = (await badge.boundingBox())!;
    expect(badgeBox.width).toBeCloseTo(initialBadge.width, 1);
    expect(badgeBox.height).toBeCloseTo(initialBadge.height, 1);
    expect(badgeBox.x + badgeBox.width / 2).toBeCloseTo(selectionBox.x + selectionBox.width / 2, 1);
    expect(badgeBox.y - selectionBox.y - selectionBox.height).toBeCloseTo(8, 1);
    await expect(selection.locator('.selection-ring')).toHaveCSS('border-top-width', '1px');
    const handle = selection.locator('[data-handle="se"]');
    await expect(handle).toHaveCSS('width', '6px');
    await expect(handle).toHaveCSS('height', '6px');
    await expect(handle).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(handle).toHaveCSS('border-top-color', 'rgb(77, 148, 255)');
    await expect(page.locator('[data-child-outline-id="text"]')).toHaveCSS('outline-width', '1px');
  }
  await page.evaluate(() => {
    const document = structuredClone(window.canvasHarness.read().document);
    const node = document.pages[0].nodes.find((node) => node.id === 'container')!;
    node.widthMode = 'fit';
    window.canvasHarness.update({ document, view: { x: 300, y: 120, zoom: 1 } });
  });
  await expect(badge).toHaveText('Fit × 250');
  await page.evaluate(() => {
    const document = structuredClone(window.canvasHarness.read().document);
    const node = document.pages[0].nodes.find((node) => node.id === 'container')!;
    node.widthMode = 'fixed';
    node.heightMode = 'fit';
    window.canvasHarness.update({ document });
  });
  await expect(badge).toHaveText('320 × Fit');
  await page.screenshot({ path: testInfo.outputPath('canvas-selection-dimensions.png') });
});

test('screen-space handles still resize a rotated nested selection and commit once', async ({
  page,
}) => {
  await openCanvas(page);
  await page.evaluate(() =>
    window.canvasHarness.update({ selected: ['text'], hovered: 'sibling' }),
  );
  const handle = (await page
    .locator('[data-selection-id="text"] [data-handle="se"]')
    .boundingBox())!;
  const angle = ((17 - 31 + 23) * Math.PI) / 180;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 40 * Math.cos(angle),
    handle.y + handle.height / 2 + 40 * Math.sin(angle),
    { steps: 5 },
  );
  await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  await page.mouse.up();
  const state = await page.evaluate(() => window.canvasHarness.read());
  const resized = state.document.pages[0].nodes.find((node) => node.id === 'text')!;
  expect(resized.width).toBe(230);
  expect(Math.abs(resized.height - 75)).toBeLessThanOrEqual(1);
  expect(state.commits).toBe(1);
  expect(state.selected).toEqual(['text']);
  await sameBounds(page.locator('[data-selection-id="text"]'), page.getByTestId('node-text'));
});
