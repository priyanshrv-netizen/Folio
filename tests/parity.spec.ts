import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

async function newFile(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Document name' })).toBeVisible();
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page.getByRole('button', { name: 'New file' }).click();
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue('Untitled');
}

async function documentSnapshot(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.getByRole('button', { name: /Folio document/ }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export file', exact: true }).click();
  const download = await downloading;
  const result = JSON.parse(await readFile((await download.path())!, 'utf8'));
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  return result;
}

test('the complete shader catalog is searchable, categorized, and editable', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await newFile(page);
  await page.getByRole('button', { name: 'Shader library', exact: true }).click();
  await expect(page.locator('.shader-card')).toHaveCount(6);
  await page.getByLabel('Shader collection').selectOption('all');
  await expect(page.locator('.shader-card')).toHaveCount(30);
  await expect(page.locator('.shader-card [data-shader-status="ready"]')).toHaveCount(30, {
    timeout: 90_000,
  });

  for (const [category, count] of [
    ['image-filter', 7],
    ['logo', 3],
    ['effect', 20],
  ] as const) {
    await page.getByLabel('Shader collection').selectOption(category);
    await expect(page.locator('.shader-card')).toHaveCount(count);
  }
  await page.getByLabel('Search shaders').fill('Voronoi');
  await expect(page.locator('.shader-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add Voronoi layer', exact: true }).click();
  await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-status', 'ready');
  await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-kind', 'voronoi');
  const originalId = await page.locator('[data-node-id]').getAttribute('data-node-id');
  await page.getByLabel('Search shaders').fill('Water');
  await page.getByRole('button', { name: 'Apply Water', exact: true }).click();
  await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-kind', 'water');
  await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-status', 'ready');
  await expect(page.locator('[data-node-id]')).toHaveAttribute('data-node-id', originalId!);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-kind', 'voronoi');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-kind', 'water');
  await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
  await page.reload();
  await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-kind', 'water');
  await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-status', 'ready');
  expect(errors).toEqual([]);
});

test('compact panels expose working collapsible sections and persisted flex layout', async ({
  page,
}) => {
  await newFile(page);
  const box = await page.locator('.canvas-viewport').boundingBox();
  if (!box) throw new Error('Canvas viewport is missing.');
  await page.getByRole('button', { name: 'Artboard tool', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 560, box.y + 440);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Add flex layout', exact: true }).click();
  await page.getByRole('button', { name: 'Vertical layout', exact: true }).click();
  await page.getByLabel('Gap', { exact: true }).fill('28');
  await page.getByLabel('Gap', { exact: true }).press('Enter');
  await page.getByLabel('Padding left', { exact: true }).fill('24');
  await page.getByLabel('Padding left', { exact: true }).press('Enter');
  await page.getByLabel('Layout alignment').selectOption('center');
  const layoutSection = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: /^Layout$/ }) });
  await layoutSection.locator('summary').click();
  await expect(page.getByLabel('Gap', { exact: true })).not.toBeVisible();
  await layoutSection.locator('summary').click();
  await expect(page.getByLabel('Gap', { exact: true })).toHaveValue('28');
  const saved = await documentSnapshot(page);
  expect(saved.pages[0].nodes[0].layout).toMatchObject({
    direction: 'column',
    gap: 28,
    paddingLeft: 24,
    align: 'center',
  });
  await expect(page.locator('.topbar')).toHaveCSS('height', '40px');
  await expect(page.locator('.tool-rail')).toHaveCSS('width', '40px');
  await page.reload();
  await page.getByRole('button', { name: 'Select layer Frame', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vertical layout', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Gap', { exact: true })).toHaveValue('28');
});

test('animated HTML downloads a live, offline shader document', async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  await newFile(page);
  await page.getByRole('button', { name: 'Shader library', exact: true }).click();
  await page.getByRole('button', { name: 'Add Mesh gradient layer', exact: true }).click();
  await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-status', 'ready');
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Animated HTML/ })).toHaveClass('active');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export file', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Untitled.animated.html');
  const savedPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(savedPath);
  const exported = await context.newPage();
  const network: string[] = [];
  exported.on('request', (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await exported.goto(pathToFileURL(savedPath).href);
  const canvas = exported.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const pixels = () => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  const initial = await pixels();
  await expect.poll(pixels).not.toBe(initial);
  await exported.emulateMedia({ reducedMotion: 'reduce' });
  await exported.waitForTimeout(300);
  const still = await pixels();
  await exported.waitForTimeout(300);
  expect(await pixels()).toBe(still);
  expect(network).toEqual([]);
  await exported.close();
});

test('dark editor appearance persists without changing artwork colors', async ({ page }) => {
  await newFile(page);
  await page.getByRole('button', { name: 'Shader library', exact: true }).click();
  await page.getByRole('button', { name: 'Add Waves layer', exact: true }).click();
  const fill = await page.locator('[data-node-id]').evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page.getByRole('button', { name: 'Dark appearance', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await expect(page.locator('.canvas-viewport')).toHaveCSS('background-color', 'rgb(38, 38, 38)');
  await expect(page.locator('[data-node-id]')).toHaveCSS('background-color', fill);
  await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await expect(page.locator('[data-node-id]')).toHaveCSS('background-color', fill);
});
