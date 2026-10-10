import { expect, test, type Page } from '@playwright/test';
import type { DesignDocument, DesignNode } from '../src/types';

function node(id: string, overrides: Partial<DesignNode> = {}): DesignNode {
  return {
    id,
    name: id,
    type: 'rectangle',
    parentId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
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
    id: 'canvas-appearance',
    name: 'Canvas appearance',
    activePageId: 'page',
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    pages: [
      {
        id: 'page',
        name: 'Page',
        nodes: [
          node('artboard', {
            type: 'frame',
            name: 'Clipped artboard',
            width: 640,
            height: 400,
            fill: '#ffffff',
            clipContent: true,
          }),
          node('clipped', {
            type: 'frame',
            parentId: 'artboard',
            x: 80,
            y: 80,
            width: 180,
            height: 180,
            fill: '#ccddee',
            clipContent: true,
          }),
          node('overflow', {
            parentId: 'clipped',
            x: 140,
            y: 40,
            fill: '#ef775c',
          }),
          node('offscreen-frame', {
            type: 'frame',
            parentId: 'clipped',
            x: 230,
            y: 135,
            width: 80,
            height: 60,
          }),
          node('offscreen-child', {
            parentId: 'offscreen-frame',
            x: 10,
            y: 10,
            width: 30,
            height: 30,
          }),
          node('locked', {
            type: 'frame',
            parentId: 'artboard',
            x: 410,
            y: 70,
            width: 130,
            height: 120,
            locked: true,
          }),
          node('locked-text', {
            type: 'text',
            parentId: 'locked',
            x: 20,
            y: 20,
            width: 90,
            height: 60,
            text: 'Locked text',
            fill: '#172033',
            fontSize: 16,
            fontFamily: 'Arial',
          }),
        ],
      },
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

async function localPoint(page: Page, id: string, x: number, y: number) {
  return page.getByTestId(`node-${id}`).evaluate(
    (element, { x, y }) => {
      let point = new DOMPoint(x, y);
      let current: Element | null = element;
      while (current?.matches('[data-node-id]')) {
        const currentStyle = getComputedStyle(current);
        const origin = currentStyle.transformOrigin.split(' ').map(parseFloat);
        const matrix = new DOMMatrix(currentStyle.transform);
        const rotated = matrix.transformPoint(
          new DOMPoint(point.x - origin[0], point.y - origin[1]),
        );
        point = new DOMPoint(
          rotated.x + origin[0] + parseFloat(currentStyle.left),
          rotated.y + origin[1] + parseFloat(currentStyle.top),
        );
        current = current.parentElement;
      }
      const view = window.canvasHarness.read().view;
      const viewport = element.closest('.canvas-viewport')!.getBoundingClientRect();
      return {
        x: viewport.x + view.x + point.x * view.zoom,
        y: viewport.y + view.y + point.y * view.zoom,
      };
    },
    { x, y },
  );
}

test('optional canvas color updates the viewport without changing the document or theme default', async ({
  page,
}) => {
  await openCanvas(page);
  const original = await page.evaluate(() => window.canvasHarness.read().document);
  await expect(page.getByTestId('canvas')).toHaveCSS('background-color', 'rgb(238, 238, 238)');
  await page.evaluate(() => window.canvasHarness.update({ canvasColor: '#282828' }));
  await expect(page.getByTestId('canvas')).toHaveCSS('background-color', 'rgb(40, 40, 40)');
  await page.evaluate(() => window.canvasHarness.update({ canvasColor: '#ccddee' }));
  await expect(page.getByTestId('canvas')).toHaveCSS('background-color', 'rgb(204, 221, 238)');
  await page.evaluate(() => window.canvasHarness.update({ canvasColor: undefined }));
  await expect(page.getByTestId('canvas')).toHaveCSS('background-color', 'rgb(238, 238, 238)');
  const state = await page.evaluate(() => window.canvasHarness.read());
  expect(state.document).toEqual(original);
  expect(state.commits).toBe(0);
});

test('appearance helpers style the wrapper and inner shadows paint after children without affecting overlays', async ({
  page,
}, testInfo) => {
  const document = fixture();
  const artboard = document.pages[0].nodes[0];
  artboard.blendMode = 'multiply';
  artboard.shadow = { color: '#12345680', x: 5, y: 7, blur: 12, spread: 3 };
  artboard.innerShadow = { color: '#345678', x: 0, y: 0, blur: 0, spread: 18 };
  artboard.filters = { blur: 1, brightness: 1.2, contrast: 0.8, saturation: 1.5 };
  artboard.opacity = 0.7;
  document.pages[0].nodes.push(
    node('cover', {
      parentId: 'artboard',
      x: 565,
      y: 300,
      width: 75,
      height: 100,
      fill: '#ffddaa',
    }),
  );
  await openCanvas(page, document);
  const wrapper = page.getByTestId('node-artboard');
  await expect(wrapper).toHaveCSS('overflow', 'hidden');
  await expect(wrapper).toHaveCSS('mix-blend-mode', 'multiply');
  await expect(wrapper).toHaveCSS('box-shadow', 'rgba(18, 52, 86, 0.5) 5px 7px 12px 3px');
  await expect(wrapper).toHaveCSS(
    'filter',
    'blur(1px) brightness(1.2) contrast(0.8) saturate(1.5)',
  );
  const shadow = wrapper.locator(':scope > .node-inner-shadow');
  await expect(shadow).toHaveCSS('box-shadow', 'rgb(52, 86, 120) 0px 0px 0px 18px inset');
  await expect(shadow).toHaveCSS('pointer-events', 'none');
  expect(
    await shadow.evaluate((element) => element === element.parentElement?.lastElementChild),
  ).toBe(true);
  const cover = await localPoint(page, 'cover', 70, 50);
  expect(
    await page.evaluate(
      ({ x, y }) =>
        window.document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-node-id]')?.dataset
          .nodeId,
      cover,
    ),
  ).toBe('cover');
  await page.evaluate(() =>
    window.canvasHarness.update({ selected: ['artboard'], canvasColor: '#e4e9f1' }),
  );
  const selection = page.locator('[data-selection-id="artboard"]');
  const label = page.locator('[data-label-id="artboard"]');
  await expect(selection).toHaveCSS('filter', 'none');
  await expect(selection).toHaveCSS('opacity', '1');
  await expect(selection.locator('.selection-ring')).toHaveCSS('border-top-width', '1px');
  await expect(selection.locator('.selection-ring')).toHaveCSS(
    'border-top-color',
    'rgb(77, 148, 255)',
  );
  await expect(label).toHaveCSS('filter', 'none');
  await expect(label).toHaveCSS('opacity', '1');
  expect(await label.evaluate((element) => Boolean(element.closest('[data-node-id]')))).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('canvas-appearance-overlays.png') });
  await page.evaluate(() => {
    const document = structuredClone(window.canvasHarness.read().document);
    const artboard = document.pages[0].nodes[0];
    delete artboard.blendMode;
    delete artboard.shadow;
    delete artboard.innerShadow;
    delete artboard.filters;
    artboard.clipContent = false;
    window.canvasHarness.update({ document });
  });
  await expect(wrapper).toHaveCSS('overflow', 'visible');
  await expect(wrapper).toHaveCSS('mix-blend-mode', 'normal');
  await expect(wrapper).toHaveCSS('box-shadow', 'none');
  await expect(wrapper).toHaveCSS('filter', 'none');
  await expect(shadow).toHaveCount(0);
});

test('clipped descendants only hit visible artwork while selection handles and artboard labels remain outside the clip', async ({
  page,
}, testInfo) => {
  await openCanvas(page);
  const inside = await localPoint(page, 'overflow', 20, 40);
  const outside = await localPoint(page, 'overflow', 75, 40);
  await page.mouse.move(inside.x, inside.y);
  await expect(page.locator('[data-hover-id]')).toHaveAttribute('data-hover-id', 'overflow');
  await page.mouse.move(outside.x, outside.y);
  await expect(page.locator('[data-hover-id]')).toHaveAttribute('data-hover-id', 'artboard');
  await page.mouse.click(outside.x, outside.y);
  expect(await page.evaluate(() => window.canvasHarness.read().selected)).toEqual(['artboard']);
  await page.evaluate(() =>
    window.canvasHarness.update({ selected: ['overflow'], hovered: 'clipped' }),
  );
  const selection = page.locator('[data-selection-id="overflow"]');
  expect(await selection.boundingBox()).toEqual(
    await page.getByTestId('node-overflow').boundingBox(),
  );
  const handle = selection.locator('[data-handle="se"]');
  const handleBox = (await handle.boundingBox())!;
  expect(
    await page.evaluate(
      ({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement)?.dataset.handle,
      { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
    ),
  ).toBe('se');
  await expect(page.locator('[data-child-outline-id="offscreen-frame"]')).toHaveCSS(
    'outline-style',
    'dashed',
  );
  await page.screenshot({ path: testInfo.outputPath('canvas-clipping-selection.png') });
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 20,
    handleBox.y + handleBox.height / 2 + 20,
  );
  await page.mouse.up();
  expect(await page.evaluate(() => window.canvasHarness.read().commits)).toBe(1);
  await page.locator('[data-label-id="artboard"]').hover();
  await expect(page.locator('[data-hover-id]')).toHaveAttribute('data-hover-id', 'artboard');
  await page.locator('[data-label-id="artboard"]').click();
  expect(await page.evaluate(() => window.canvasHarness.read().selected)).toEqual(['artboard']);
  await page.evaluate(() => {
    const document = structuredClone(window.canvasHarness.read().document);
    document.pages[0].nodes.find((node) => node.id === 'clipped')!.clipContent = false;
    window.canvasHarness.update({ document, selected: [] });
  });
  await page.mouse.move(outside.x, outside.y);
  await expect(page.locator('[data-hover-id]')).toHaveAttribute('data-hover-id', 'overflow');
});

test('rotated rounded frame clipping uses native hit testing for hover and clicks', async ({
  page,
}) => {
  const document = fixture();
  const artboard = document.pages[0].nodes[0];
  artboard.rotation = 13;
  const clipped = document.pages[0].nodes[1];
  clipped.rotation = -25;
  clipped.radius = 40;
  document.pages[0].nodes.push(node('corner', { parentId: 'clipped', width: 20, height: 20 }));
  await openCanvas(page, document);
  const inside = await localPoint(page, 'overflow', 20, 40);
  const outside = await localPoint(page, 'overflow', 75, 40);
  const corner = await localPoint(page, 'corner', 1, 1);
  await page.mouse.move(inside.x, inside.y);
  await expect(page.locator('[data-hover-id]')).toHaveAttribute('data-hover-id', 'overflow');
  for (const point of [outside, corner]) {
    await page.evaluate(() => window.canvasHarness.update({ selected: [] }));
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('[data-hover-id]')).toHaveAttribute('data-hover-id', 'artboard');
    await page.mouse.click(point.x, point.y);
    expect(await page.evaluate(() => window.canvasHarness.read().selected)).toEqual(['artboard']);
  }
});

test('locked descendants cannot hover, select, edit, or receive newly drawn children', async ({
  page,
}) => {
  await openCanvas(page);
  const point = await localPoint(page, 'locked-text', 45, 30);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('[data-hover-id]')).toHaveCount(0);
  await page.mouse.dblclick(point.x, point.y);
  expect(await page.evaluate(() => window.canvasHarness.read().selected)).toEqual([]);
  await expect(page.locator('textarea')).toHaveCount(0);
  await page.evaluate(() => window.canvasHarness.update({ tool: 'rectangle' }));
  await page.mouse.click(point.x, point.y);
  const state = await page.evaluate(() => window.canvasHarness.read());
  expect(state.document.pages[0].nodes.at(-1)?.parentId).toBe('artboard');
  expect(state.commits).toBe(1);
});

test('marquee selection ignores fully clipped, hidden, and locked descendants and uses visible bounds', async ({
  page,
}) => {
  const document = fixture();
  document.pages[0].nodes.push(
    node('marquee-visible', { parentId: 'artboard', x: 440, y: 280, width: 80, height: 70 }),
    node('hidden-parent', { type: 'frame', parentId: 'artboard', x: 410, y: 220, visible: false }),
    node('hidden-child', { parentId: 'hidden-parent', x: 10, y: 10, width: 30, height: 30 }),
  );
  await openCanvas(page, document);
  const start = await localPoint(page, 'artboard', 660, 420);
  const end = await localPoint(page, 'artboard', 200, 110);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  const state = await page.evaluate(() => window.canvasHarness.read());
  expect(state.selected).toEqual(['overflow', 'marquee-visible']);
  expect(state.commits).toBe(0);
});

test('drawing in the clipped portion of a descendant uses the visible ancestor as its parent', async ({
  page,
}) => {
  await openCanvas(page);
  const point = await localPoint(page, 'offscreen-child', 15, 15);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('[data-hover-id]')).toHaveAttribute('data-hover-id', 'artboard');
  await page.evaluate(() => window.canvasHarness.update({ tool: 'rectangle' }));
  await page.mouse.click(point.x, point.y);
  const state = await page.evaluate(() => window.canvasHarness.read());
  expect(state.document.pages[0].nodes.at(-1)?.parentId).toBe('artboard');
  expect(state.commits).toBe(1);
});
