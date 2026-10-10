import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openEditor(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Document name' })).toBeVisible();
}

async function snapshot(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: /Folio document/ }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export file', exact: true }).click();
  const file = await downloading;
  const document = JSON.parse(await readFile((await file.path())!, 'utf8'));
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  return document;
}

test('bundle-guided chrome keeps compact dimensions, working page disclosure, and both themes', async ({
  page,
}) => {
  await openEditor(page);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await expect(page.locator('.topbar')).toHaveCSS('height', '40px');
  await expect(page.locator('.left-panel')).toHaveCSS('width', '240px');
  await expect(page.locator('.tool-rail')).toHaveCSS('width', '40px');
  await expect(page.locator('.inspector')).toHaveCSS('width', '280px');
  await expect(page.locator('.inspector-toolbar')).toBeVisible();
  await expect(page.locator('.inspector .panel-tabs')).toHaveCount(0);
  await expect(page.locator('.inspector .material-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Page 1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Page 1', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Design / Layers' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Theme', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Theme tokens' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Design / Layers' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page.getByRole('button', { name: 'Light appearance', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  await expect(page.locator('.inspector')).toHaveCSS('background-color', 'rgb(242, 242, 242)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
});

test('header zoom preserves the center and closes on selection, outside click, and Escape', async ({
  page,
}) => {
  await openEditor(page);
  const worldCenter = () =>
    page.locator('.canvas-world').evaluate((world) => {
      const viewport = world.parentElement!;
      const matrix = new DOMMatrix((world as HTMLElement).style.transform);
      return {
        x: (viewport.clientWidth / 2 - matrix.e) / matrix.a,
        y: (viewport.clientHeight / 2 - matrix.f) / matrix.d,
      };
    });
  const before = await worldCenter();
  await page.getByLabel('Canvas zoom', { exact: true }).click();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await expect(page.locator('.zoom-menu')).not.toHaveAttribute('open');
  await expect(page.getByLabel('Canvas zoom', { exact: true })).toContainText('100%');
  const after = await worldCenter();
  expect(after.x).toBeCloseTo(before.x, 2);
  expect(after.y).toBeCloseTo(before.y, 2);
  await page.getByLabel('Canvas zoom', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Document name' }).click();
  await expect(page.locator('.zoom-menu')).not.toHaveAttribute('open');
  await page.getByLabel('Canvas zoom', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.zoom-menu')).not.toHaveAttribute('open');
});

test('page color is a real undoable saved property and is included in editable export', async ({
  page,
}) => {
  await openEditor(page);
  const color = page.getByRole('textbox', { name: 'Page hex', exact: true });
  await color.fill('#30343b');
  await color.press('Enter');
  await expect(page.locator('.canvas-viewport')).toHaveCSS('background-color', 'rgb(48, 52, 59)');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.canvas-viewport')).toHaveCSS('background-color', 'rgb(38, 38, 38)');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const saved = await snapshot(page);
  expect(saved.pages[0].canvasColor).toBe('#30343b');
  await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
  await page.reload();
  await expect(page.locator('.canvas-viewport')).toHaveCSS('background-color', 'rgb(48, 52, 59)');
});

test('theme tokens edit artwork, validate locally, and detach without losing the resolved color', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Select layer Accent', exact: true }).click();
  const artwork = page.locator('[data-node-type="ellipse"]');
  await page.getByRole('tab', { name: 'Theme', exact: true }).click();
  await page.getByRole('button', { name: 'Create token', exact: true }).click();
  await page.getByLabel('Token name', { exact: true }).fill('Brand');
  await page.getByLabel('Token color', { exact: true }).fill('#cc3344');
  await page.getByRole('button', { name: 'Save token', exact: true }).click();
  await page.getByRole('button', { name: 'Apply token Brand', exact: true }).click();
  await expect(artwork).toHaveCSS('background-color', 'rgb(204, 51, 68)');
  await page.getByRole('button', { name: 'Add theme token', exact: true }).click();
  await page.getByLabel('Token name', { exact: true }).fill('brand');
  await page.getByRole('button', { name: 'Save token', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already exists');
  await page.getByLabel('Token name', { exact: true }).fill('Secondary');
  await page.getByLabel('Token color', { exact: true }).fill('#aabbcc44');
  await page.getByRole('button', { name: 'Save token', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('opaque hex');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit token Brand', exact: true }).click();
  await page.getByLabel('Token color', { exact: true }).fill('#3344cc');
  await page.getByRole('button', { name: 'Save token', exact: true }).click();
  await expect(artwork).toHaveCSS('background-color', 'rgb(51, 68, 204)');
  await page.getByRole('button', { name: 'Delete token Brand', exact: true }).click();
  await expect(artwork).toHaveCSS('background-color', 'rgb(51, 68, 204)');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit token Brand', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Fill hex', exact: true }).fill('#228855');
  await page.getByRole('textbox', { name: 'Fill hex', exact: true }).press('Enter');
  const saved = await snapshot(page);
  const node = saved.pages[0].nodes.find((node: { name: string }) => node.name === 'Accent');
  expect(node.fill).toBe('#228855');
  expect(node.fillTokenId).toBeUndefined();
  await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
  await page.reload();
  await expect(artwork).toHaveCSS('background-color', 'rgb(34, 136, 85)');
});
