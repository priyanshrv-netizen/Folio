import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createSettingsStore, DEFAULT_SETTINGS } from './settings.mjs';

function secureStorage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => 'keychain'),
    encryptString: vi.fn((value) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    }),
    decryptString: vi.fn((bytes) => {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(
        'utf8',
      );
    }),
  };
}

describe('encrypted settings', () => {
  let directory;
  let encryption;
  let store;
  const input = () => structuredClone(DEFAULT_SETTINGS);
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'folio-settings-'));
    encryption = secureStorage();
    store = createSettingsStore(directory, encryption);
  });
  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('defaults to local storage, AWS region and the image generation endpoint', async () => {
    expect(await store.getSettings()).toEqual({
      storage: { ...DEFAULT_SETTINGS.storage, hasCredentials: false },
      image: { ...DEFAULT_SETTINGS.image, hasApiKey: false },
    });
    expect(encryption.decryptString).not.toHaveBeenCalled();
  });

  it('encrypts credentials together, never returns them, and can reopen the file', async () => {
    const settings = input();
    settings.storage.accessKeyId = 'FAKE_ACCESS_KEY';
    settings.storage.secretAccessKey = 'FAKE_SECRET_VALUE';
    settings.image.apiKey = 'FAKE_IMAGE_TOKEN';
    const result = await store.saveSettings(settings);
    expect(result.storage.hasCredentials).toBe(true);
    expect(result.image.hasApiKey).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/FAKE_/);
    const disk = await readFile(join(directory, 'settings.json'), 'utf8');
    expect(disk).not.toMatch(/FAKE_|accessKeyId|secretAccessKey|apiKey/);
    const reopened = createSettingsStore(directory, encryption);
    expect(await reopened.getSettings()).toEqual(result);
    expect((await reopened.getPrivateSettings()).secrets.apiKey).toBe('FAKE_IMAGE_TOKEN');
  });

  it('preserves omitted secrets across edits and clears them only explicitly', async () => {
    const settings = input();
    Object.assign(settings.storage, { accessKeyId: 'FAKE_ACCESS', secretAccessKey: 'FAKE_SECRET' });
    settings.image.apiKey = 'FAKE_IMAGE';
    await store.saveSettings(settings);
    const changed = input();
    changed.storage.bucket = 'test-bucket';
    expect((await store.saveSettings(changed)).image.hasApiKey).toBe(true);
    expect((await store.getPrivateSettings()).secrets.accessKeyId).toBe('FAKE_ACCESS');
    changed.storage.clearCredentials = true;
    changed.image.clearApiKey = true;
    const cleared = await store.saveSettings(changed);
    expect(cleared.storage.hasCredentials).toBe(false);
    expect(cleared.image.hasApiKey).toBe(false);
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))).not.toHaveProperty(
      'encryptedSecrets',
    );
  });

  it('serializes secret updates so omitted secrets are not lost', async () => {
    const first = input();
    Object.assign(first.storage, { accessKeyId: 'FAKE_ACCESS', secretAccessKey: 'FAKE_SECRET' });
    const second = input();
    second.image.apiKey = 'FAKE_IMAGE';
    await Promise.all([store.saveSettings(first), store.saveSettings(second)]);
    expect((await store.getSettings()).storage.hasCredentials).toBe(true);
    expect((await store.getSettings()).image.hasApiKey).toBe(true);
  });

  it.each(['unavailable', 'basic_text'])(
    'refuses %s credential storage without writing plaintext',
    async (mode) => {
      if (mode === 'unavailable') encryption.isEncryptionAvailable.mockReturnValue(false);
      else encryption.getSelectedStorageBackend.mockReturnValue('basic_text');
      await store.saveSettings(input());
      const settings = input();
      settings.image.apiKey = 'FAKE_IMAGE';
      await expect(store.saveSettings(settings)).rejects.toThrow(/Secure operating-system/);
      expect(encryption.encryptString).not.toHaveBeenCalled();
      expect(await readFile(join(directory, 'settings.json'), 'utf8')).not.toContain('FAKE_IMAGE');
    },
  );

  it('sanitizes encryption and decryption failures', async () => {
    const settings = input();
    settings.image.apiKey = 'FAKE_IMAGE';
    encryption.encryptString.mockImplementationOnce(() => {
      throw new Error('FAKE_IMAGE leaked by library');
    });
    await expect(store.saveSettings(settings)).rejects.toThrow(
      'Credentials could not be encrypted.',
    );
    await store.saveSettings(settings);
    encryption.decryptString.mockImplementation(() => {
      throw new Error('FAKE_IMAGE leaked by library');
    });
    await expect(store.getSettings()).rejects.toThrow('Stored credentials could not be unlocked.');
  });

  it.each([
    (value) => {
      value.storage.accessKeyId = 'only-half';
    },
    (value) => {
      value.storage.clearCredentials = 'yes';
    },
    (value) => {
      value.image.apiKey = 'bad\nheader';
    },
    (value) => {
      value.image.apiKey = 'fake';
      value.image.clearApiKey = true;
    },
    (value) => {
      value.storage.provider = 'disk';
    },
    (value) => {
      value.storage.prefix = '../other/';
    },
    (value) => {
      value.storage.bucket = 'bad/bucket';
    },
    (value) => {
      value.storage.endpoint = 'http://example.test';
    },
    (value) => {
      value.image.endpoint = 'https://user:pass@example.test/image';
    },
    (value) => {
      value.image.endpoint = 'file:///tmp/image';
    },
    (value) => {
      value.image.endpoint = 'https://example.test/#secret';
    },
  ])('rejects invalid configuration', async (change) => {
    const settings = input();
    change(settings);
    await expect(store.saveSettings(settings)).rejects.toThrow();
  });

  it('supports blank AWS endpoints, R2 auto region and loopback providers', async () => {
    const settings = input();
    settings.storage.provider = 's3';
    settings.storage.endpoint = 'https://account.r2.cloudflarestorage.com';
    settings.storage.region = 'auto';
    settings.storage.prefix = 'backups/designs';
    settings.image.endpoint = 'http://localhost:3456/images';
    const result = await store.saveSettings(settings);
    expect(result.storage.region).toBe('auto');
    expect(result.storage.prefix).toBe('backups/designs/');
    expect(result.image.endpoint).toBe('http://localhost:3456/images');
  });

  it('rejects corrupt persisted files rather than silently erasing credentials', async () => {
    await writeFile(join(directory, 'settings.json'), '{broken');
    await expect(store.getSettings()).rejects.toThrow();
    await expect(store.saveSettings(input())).rejects.toThrow();
    expect(await readFile(join(directory, 'settings.json'), 'utf8')).toBe('{broken');
  });
});
