import { test, expect, type Page } from '@playwright/test';

async function newFile(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue(
    'A little room to create',
  );
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page.getByRole('button', { name: 'New file', exact: false }).click();
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue('Untitled');
}

async function draw(page: Page, tool: string, start: [number, number], end: [number, number]) {
  await page.getByRole('button', { name: `${tool} tool`, exact: true }).click();
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + start[0], box.y + start[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + end[0], box.y + end[1], { steps: 10 });
  await page.mouse.up();
}

test('create, draw, edit, duplicate, undo, resize, autosave and reopen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await newFile(page);
  await page.getByRole('textbox', { name: 'Document name' }).fill('Persistence proof');
  await page.getByRole('textbox', { name: 'Document name' }).press('Enter');
  await draw(page, 'Artboard', [140, 120], [700, 600]);
  await expect(page.locator('[data-node-type="frame"]')).toHaveCount(1);
  await draw(page, 'Rectangle', [200, 220], [400, 340]);
  const rectangle = page.locator('[data-node-type="rectangle"]');
  await expect(rectangle).toHaveCount(1);
  await expect(page.getByRole('spinbutton', { name: 'W', exact: true })).toHaveValue('200');
  await expect(page.getByRole('spinbutton', { name: 'H', exact: true })).toHaveValue('120');
  await page.getByRole('textbox', { name: 'Layer name' }).fill('My rectangle');
  await page.getByRole('textbox', { name: 'Layer name' }).press('Enter');
  await page.getByRole('textbox', { name: 'Fill hex' }).fill('#336699');
  await page.getByRole('textbox', { name: 'Fill hex' }).press('Enter');
  await expect(rectangle).toHaveCSS('background-color', 'rgb(51, 102, 153)');
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(rectangle).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(rectangle).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(rectangle).toHaveCount(2);
  await page.getByRole('button', { name: 'Select layer My rectangle', exact: true }).click();
  const handle = page.locator('.selected [data-handle="se"]');
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + bounds.height / 2 + 30, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(page.getByRole('spinbutton', { name: 'W', exact: true })).toHaveValue('240');
  await expect(page.getByRole('spinbutton', { name: 'H', exact: true })).toHaveValue('150');
  await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue(
    'Persistence proof',
  );
  await expect(page.locator('[data-node-type="rectangle"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select layer My rectangle', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'W', exact: true })).toHaveValue('240');
  await expect(page.getByRole('textbox', { name: 'Fill hex' })).toHaveValue('#336699');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('edit text, preserve typing shortcuts, export and reimport all pages', async ({ page }) => {
  await newFile(page);
  await draw(page, 'Text', [180, 160], [500, 270]);
  const text = page.getByRole('textbox', { name: 'Edit text on canvas' });
  await text.fill('A canvas of our own.');
  await text.press('Control+Enter');
  await expect(page.locator('.node-text')).toHaveText('A canvas of our own.');
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Page 2', exact: true })).toBeVisible();
  await draw(page, 'Ellipse', [200, 180], [340, 320]);
  await expect(page.locator('[data-node-type="ellipse"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.getByRole('button', { name: /Folio document/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export file', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Untitled.folio.json');
  const saved = await download.path();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page.getByRole('button', { name: 'New file', exact: false }).click();
  await expect(page.locator('[data-node-id]')).toHaveCount(0);
  await page.getByLabel('Import document file').setInputFiles(saved!);
  await expect(page.locator('[data-node-type="ellipse"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Page 1', exact: true }).click();
  await expect(page.locator('.node-text')).toHaveText('A canvas of our own.');
});

test('exports real PNG and HTML without network dependencies', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-node-type="frame"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const pngPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export file', exact: true }).click();
  const png = await pngPromise;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole('button', { name: /HTML \+ CSS/ }).click();
  const htmlPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export file', exact: true }).click();
  const html = await htmlPromise;
  expect(html.suggestedFilename()).toMatch(/\.html$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('rejects malformed imports without replacing work, and gates provider keys to desktop', async ({
  page,
}) => {
  await newFile(page);
  await page.getByLabel('Import document file').setInputFiles({
    name: 'unsafe.folio.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":999}'),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid document');
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue('Untitled');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('browser preview');
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  await page.getByRole('button', { name: 'Image generation', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Image API endpoint' })).toHaveValue(
    'https://api.openai.com/v1/images/generations',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('image import stays embedded, and deleting an artboard is one undoable operation', async ({
  page,
}) => {
  await newFile(page);
  await draw(page, 'Artboard', [150, 140], [700, 610]);
  await draw(page, 'Rectangle', [210, 210], [300, 310]);
  await page.getByRole('button', { name: 'Select layer Frame', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-node-id]')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-node-id]')).toHaveCount(2);
  await page.getByLabel('Import image file').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.locator('[data-node-type="image"] img')).toHaveAttribute(
    'src',
    /^data:image\/png;base64,/,
  );
  await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
  await page.reload();
  await expect(page.locator('[data-node-type="image"] img')).toBeVisible();
});
