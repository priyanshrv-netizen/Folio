import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

test('desktop persists files and encrypted settings, then generates through the configured local provider', async () => {
  test.setTimeout(120000);
  const dataDirectory = await mkdtemp(join(tmpdir(), 'folio-desktop-e2e-'));
  const requests: { path: string; authorized: boolean; prompt?: string }[] = [];
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/images/generations') {
      response.writeHead(404);
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({
      path: request.url,
      authorized: request.headers.authorization === 'Bearer folio-fake-test-key',
      prompt: payload.prompt,
    });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        data: [
          {
            b64_json:
              'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAH0lEQVR4AYSIsQ0AAAiDiP//rHZqtyYwwACbanybPg4AAP//A6LNzAAAAAZJREFUAwDosAQFdPHNIgAAAABJRU5ErkJggg==',
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      args: ['.'],
      cwd: process.cwd(),
      env: { ...process.env, FOLIO_DATA_DIR: dataDirectory },
    });
    let page = await application.firstWindow();
    await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue(
      'A little room to create',
    );
    const capabilities = await page.evaluate(() => ({
      bridge: Boolean(window.folio),
      node: typeof (window as unknown as Record<string, unknown>).require,
    }));
    expect(capabilities).toEqual({ bridge: true, node: 'undefined' });
    const security = await application.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as {
        getLastWebPreferences(): {
          sandbox: boolean;
          contextIsolation: boolean;
          nodeIntegration: boolean;
        };
      };
      const prefs = contents.getLastWebPreferences();
      return {
        sandbox: prefs.sandbox,
        contextIsolation: prefs.contextIsolation,
        nodeIntegration: prefs.nodeIntegration,
      };
    });
    expect(security).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    await page.getByRole('textbox', { name: 'Document name' }).fill('Desktop persistence proof');
    await page.getByRole('textbox', { name: 'Document name' }).press('Enter');
    await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
    const documentFiles = await readdir(join(dataDirectory, 'documents'));
    expect(documentFiles).toHaveLength(1);
    const saved = JSON.parse(
      await readFile(join(dataDirectory, 'documents', documentFiles[0]), 'utf8'),
    );
    expect(saved.name).toBe('Desktop persistence proof');
    expect(saved.pages[0].nodes).toHaveLength(14);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Image generation', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Image API endpoint' })
      .fill(`http://127.0.0.1:${port}/v1/images/generations`);
    await page.getByRole('textbox', { name: 'Image model' }).fill('local-test-model');
    await page.getByLabel('Image API key', { exact: true }).fill('folio-fake-test-key');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Image API key', { exact: true })).toHaveValue('');
    const settingsFile = await readFile(join(dataDirectory, 'settings.json'), 'utf8');
    expect(settingsFile).not.toContain('folio-fake-test-key');
    expect(JSON.parse(settingsFile).encryptedSecrets).toBeTruthy();
    const publicSettings = await page.evaluate(() => window.folio!.getSettings());
    expect(publicSettings.image.hasApiKey).toBe(true);
    expect(JSON.stringify(publicSettings)).not.toContain('folio-fake-test-key');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Generate image', exact: true }).click();
    await page.getByRole('textbox', { name: 'Image prompt' }).fill('A tiny local test image');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Generate image', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-node-type="image"] img')).toHaveAttribute(
      'src',
      /^data:image\/png;base64,/,
    );
    expect(requests).toEqual([
      { path: '/v1/images/generations', authorized: true, prompt: 'A tiny local test image' },
    ]);
    await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
    await application.close();
    application = await electron.launch({
      args: ['.'],
      cwd: process.cwd(),
      env: { ...process.env, FOLIO_DATA_DIR: dataDirectory },
    });
    page = await application.firstWindow();
    await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue(
      'Desktop persistence proof',
    );
    await expect(page.locator('[data-node-type="image"] img')).toBeVisible();
    expect((await page.evaluate(() => window.folio!.getSettings())).image.hasApiKey).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await application?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
