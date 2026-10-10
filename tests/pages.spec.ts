import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDocument, createNode } from '../src/model';
import type { DesignDocument } from '../src/types';

async function openFixture(page: Page, count = 3) {
  const document = createDocument('Page workflow');
  document.pages = Array.from({ length: count }, (_, index) => ({
    id: `page-${index + 1}`,
    name: `Page ${index + 1}`,
    nodes:
      index === 0
        ? [
            createNode('frame', { id: 'cover', name: 'Cover artwork', clipContent: true }),
            createNode('rectangle', {
              id: 'accent',
              name: 'Accent',
              parentId: 'cover',
              fill: '#336699',
            }),
          ]
        : [],
    canvasColor: index === 0 ? '#30343b' : '#262626',
  }));
  document.activePageId = 'page-1';
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Document name' })).toBeVisible();
  await page.getByLabel('Import document file').setInputFiles({
    name: 'pages.folio.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue('Page workflow');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  return document;
}

async function menu(page: Page, name: string) {
  await page.getByRole('button', { name: `Page actions for ${name}`, exact: true }).click();
  return page.getByRole('menu', { name: `Actions for ${name}`, exact: true });
}

async function snapshot(page: Page): Promise<DesignDocument> {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: /Folio document/ }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export file', exact: true }).click();
  const file = await downloading;
  const document = JSON.parse(await readFile((await file.path())!, 'utf8'));
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  return document;
}

test('page names validate, cancel without history, and commit once with keyboard undo and redo', async ({
  page,
}) => {
  await openFixture(page);
  const first = page.getByRole('button', { name: 'Page 1', exact: true });
  await first.focus();
  await first.press('F2');
  const input = page.getByRole('textbox', { name: 'Page name', exact: true });
  await expect(input).toBeFocused();
  await input.fill('   ');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('1–256');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(first).toBeFocused();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  await first.dblclick();
  await input.fill('Discard this name');
  await input.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  await (await menu(page, 'Page 1')).getByRole('menuitem', { name: 'Rename page' }).click();
  await input.fill('  Cover — 日本語  ');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Cover — 日本語', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.keyboard.press('Control+z');
  await expect(first).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('button', { name: 'Cover — 日本語', exact: true })).toBeVisible();
  await expect(page.locator('.canvas-viewport')).toHaveCSS('background-color', 'rgb(48, 52, 59)');
});

test('page actions preserve selection and artwork, and deletion restores everything in one undo', async ({
  page,
}) => {
  const original = await openFixture(page);
  await page.getByRole('button', { name: 'Select layer Cover artwork', exact: true }).click();
  await (await menu(page, 'Page 1')).getByRole('menuitem', { name: 'Move down' }).click();
  await expect(page.locator('.page-select')).toHaveText(['Page 2', 'Page 1', 'Page 3']);
  await expect(page.getByRole('textbox', { name: 'Layer name' })).toHaveValue('Cover artwork');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.page-select')).toHaveText(['Page 1', 'Page 2', 'Page 3']);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();

  await (await menu(page, 'Page 1')).getByRole('menuitem', { name: 'Delete page' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete page', exact: true });
  await expect(confirmation).toContainText('Page 1');
  await page.getByRole('button', { name: 'Cancel', exact: true }).press('Delete');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('[data-node-id]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Page 1', exact: true }).press('Delete');
  await confirmation.getByRole('button', { name: 'Delete page', exact: true }).click();
  await expect(page.locator('.page-select')).toHaveText(['Page 2', 'Page 3']);
  await expect(page.getByRole('button', { name: 'Page 3', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('button', { name: 'Page 3', exact: true })).toBeFocused();
  await expect(page.locator('[data-node-id]')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Layer name' })).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.page-select')).toHaveText(['Page 2', 'Page 1', 'Page 3']);
  await expect(page.getByRole('button', { name: 'Page 1', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect((await snapshot(page)).pages[1]).toEqual(original.pages[0]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('[data-node-id]')).toHaveCount(0);
});

test('renaming, reordering, and inactive-page deletion survive reload and editable export', async ({
  page,
}) => {
  const original = await openFixture(page);
  await (await menu(page, 'Page 1')).getByRole('menuitem', { name: 'Rename page' }).click();
  await page.getByRole('textbox', { name: 'Page name', exact: true }).fill('Landing');
  await page.getByRole('button', { name: 'Save page name', exact: true }).click();
  await (await menu(page, 'Landing')).getByRole('menuitem', { name: 'Move down' }).click();
  await (await menu(page, 'Page 3')).getByRole('menuitem', { name: 'Delete page' }).click();
  await page
    .getByRole('dialog', { name: 'Delete page' })
    .getByRole('button', { name: 'Delete page', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Landing', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
  await page.reload();
  await expect(page.locator('.page-select')).toHaveText(['Page 2', 'Landing']);
  const saved = await snapshot(page);
  expect(saved.pages).toEqual([original.pages[1], { ...original.pages[0], name: 'Landing' }]);
  expect(saved.activePageId).toBe('page-1');
});

test('dragging pages changes only their order and is one undoable transaction', async ({
  page,
}) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Select layer Cover artwork', exact: true }).click();
  const first = page.getByRole('button', { name: 'Page 1', exact: true });
  await first.dragTo(page.locator('[data-page-id="page-3"]'), { targetPosition: { x: 80, y: 26 } });
  await expect(page.locator('.page-select')).toHaveText(['Page 2', 'Page 3', 'Page 1']);
  await expect(first).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('textbox', { name: 'Layer name' })).toHaveValue('Cover artwork');
  await expect(page.locator('[data-drop]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.page-select')).toHaveText(['Page 1', 'Page 2', 'Page 3']);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await first.dragTo(page.locator('[data-page-id="page-2"]'), { targetPosition: { x: 80, y: 2 } });
  await expect(page.locator('.page-select')).toHaveText(['Page 1', 'Page 2', 'Page 3']);
});

test('page menus and list navigation work from the keyboard without nudging canvas selection', async ({
  page,
}) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Select layer Cover artwork', exact: true }).click();
  const before = await page.getByRole('spinbutton', { name: 'Y', exact: true }).inputValue();
  const first = page.getByRole('button', { name: 'Page 1', exact: true });
  await first.focus();
  await first.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Page 2', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: 'Page 3', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue(before);
  const trigger = page.getByRole('button', { name: 'Page actions for Page 1' });
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Rename page' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await menu(page, 'Page 1');
  await trigger.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await menu(page, 'Page 1');
  await page.getByRole('textbox', { name: 'Document name' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await menu(page, 'Page 1');
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await first.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('long page names and action menus fit the narrow light-theme panel', async ({ page }) => {
  await openFixture(page);
  await page.setViewportSize({ width: 960, height: 700 });
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page.getByRole('button', { name: 'Light appearance', exact: true }).click();
  await (await menu(page, 'Page 2')).getByRole('menuitem', { name: 'Rename page' }).click();
  const name = 'A very long page name '.repeat(8);
  await page.getByRole('textbox', { name: 'Page name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save page name', exact: true }).click();
  await expect(page.getByRole('button', { name: name.trim(), exact: true })).toHaveCSS(
    'height',
    '28px',
  );
  const bounds = await page.locator('.page-list').evaluate((list) => ({
    width: list.clientWidth,
    content: list.scrollWidth,
  }));
  expect(bounds.content).toBe(bounds.width);
  const actions = await menu(page, name.trim());
  await expect(actions).toHaveCSS('background-color', 'rgb(242, 242, 242)');
  const box = (await actions.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(960);
  await actions.getByRole('menuitem', { name: 'Move up' }).click();
  await expect(page.locator('.page-select').first()).toHaveText(name.trim());
  await expect(page.getByRole('button', { name: 'Page 1', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('last-page and maximum-page guards remain usable with a scrollable compact list', async ({
  page,
}) => {
  await openFixture(page, 1);
  const only = await menu(page, 'Page 1');
  for (const name of ['Delete page', 'Move up', 'Move down'])
    await expect(only.getByRole('menuitem', { name, exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Page 1', exact: true }).press('Delete');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-node-id]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pages', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Page 2', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await openFixture(page, 100);
  await expect(page.getByRole('button', { name: 'Add page', exact: true })).toBeDisabled();
  const list = await page.locator('.page-list').evaluate((element) => ({
    height: element.clientHeight,
    scroll: element.scrollHeight,
    viewport: window.innerHeight,
  }));
  expect(list.height).toBeLessThanOrEqual(list.viewport * 0.3);
  expect(list.scroll).toBeGreaterThan(list.height);
  await page.getByRole('button', { name: 'Page 100', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Page 100', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
