import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function blank(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Document name' })).toBeVisible();
  await page.getByRole('button', { name: 'File menu', exact: true }).click();
  await page.getByRole('button', { name: 'New file', exact: false }).click();
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue('Untitled');
  await page.getByRole('button', { name: 'Shader library', exact: true }).click();
  await expect(page.locator('.shader-card-image [data-shader-status="ready"]')).toHaveCount(6);
}

test('genuine shaders render, animate, pause, edit, undo, persist, and export', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await blank(page);
  await page.getByRole('button', { name: 'Add Mesh gradient layer', exact: true }).click();
  const shader = page.locator('.shader-live');
  const canvas = shader.locator('canvas');
  await expect(shader).toHaveAttribute('data-shader-status', 'ready');
  await expect(shader).toHaveAttribute('data-shader-motion', 'playing');
  const pixels = () => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  const playing = await pixels();
  await expect.poll(pixels).not.toBe(playing);
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect(shader).toHaveAttribute('data-shader-motion', 'paused');
  await page.waitForTimeout(100);
  const paused = await pixels();
  await page.waitForTimeout(250);
  expect(await pixels()).toBe(paused);
  await page.getByRole('textbox', { name: 'Shader color 1', exact: true }).fill('#112233');
  await page.getByRole('textbox', { name: 'Shader color 1', exact: true }).press('Enter');
  await expect.poll(pixels).not.toBe(paused);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Shader color 1', exact: true })).not.toHaveValue(
    '#112233',
  );
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Shader color 1', exact: true })).toHaveValue(
    '#112233',
  );
  await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
  await page.reload();
  await expect(shader).toHaveAttribute('data-shader-status', 'ready');
  await expect(shader).toHaveAttribute('data-shader-motion', 'paused');
  await page
    .getByRole('button', { name: 'Select layer Mesh Gradient shader', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Shader color 1', exact: true })).toHaveValue(
    '#112233',
  );
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  for (const format of ['SVG', 'HTML + CSS', 'Folio document']) {
    await page.getByRole('button', { name: new RegExp(format.replace('+', '\\+')) }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export file', exact: true }).click();
    const file = await pending;
    const content = await readFile((await file.path())!, 'utf8');
    if (format === 'Folio document')
      expect(JSON.parse(content).pages[0].nodes[0].shader).toMatchObject({
        kind: 'mesh-gradient',
        paused: true,
        colors: expect.arrayContaining(['#112233']),
      });
    else expect(content).toContain('data:image/png;base64,');
  }
  expect(errors).toEqual([]);
});

test('all six shader types can be inserted and changed without replacing the layer', async ({
  page,
}) => {
  await blank(page);
  for (const name of [
    'Mesh gradient',
    'Grain gradient',
    'Liquid metal',
    'Waves',
    'Dot orbit',
    'Smoke ring',
  ]) {
    await page.getByRole('button', { name: `Add ${name} layer`, exact: true }).click();
    await expect(page.locator('.shader-live[data-shader-status="error"]')).toHaveCount(0);
  }
  await expect(page.locator('.shader-live[data-shader-status="ready"]')).toHaveCount(6);
  await page.getByRole('button', { name: 'Apply Liquid metal', exact: true }).click();
  await expect(page.locator('.shader-live[data-shader-kind="liquid-metal"]')).toHaveCount(2);
  await expect(page.locator('[data-node-id]')).toHaveCount(6);
  await page.getByRole('button', { name: 'Solid', exact: true }).click();
  await expect(page.locator('.shader-live')).toHaveCount(5);
  await expect(page.locator('[data-node-id]')).toHaveCount(6);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.shader-live')).toHaveCount(6);
});

test('playground preserves the previous file and panels and layer search remain usable', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open shader playground', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue(
    'Form & frequency',
  );
  await expect(page.locator('.shader-live[data-shader-status="ready"]')).toHaveCount(3);
  await page.getByRole('tab', { name: /Layers/ }).click();
  await page.getByRole('textbox', { name: 'Search layers' }).fill('Headline');
  await expect(page.locator('.layer-select')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select layer Headline', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Layer name', exact: true })).toHaveValue(
    'Headline',
  );
  await page.getByRole('button', { name: 'Hide panels', exact: true }).click();
  await expect(page.locator('.left-panel')).toBeHidden();
  await expect(page.locator('.inspector')).toBeHidden();
  await page.getByRole('button', { name: 'Show panels', exact: true }).click();
  await expect(page.locator('.left-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Your files', exact: true }).click();
  await expect(page.getByRole('button', { name: /A little room to create/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Form & frequency/ })).toBeVisible();
});

test('browser mode explains the desktop MCP boundary and reduced motion pauses shaders', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await blank(page);
  await page.getByRole('button', { name: 'Add Mesh gradient layer', exact: true }).click();
  await expect(page.locator('.shader-live')).toHaveAttribute('data-shader-motion', 'paused');
  await page.getByRole('button', { name: 'Connect agents', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'browser preview can’t host a local MCP server',
  );
  await expect(page.getByRole('button', { name: 'Enable MCP', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect agents', exact: true })).toBeFocused();
});
