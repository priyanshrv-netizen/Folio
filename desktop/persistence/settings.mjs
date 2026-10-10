import { join } from 'node:path';
import { atomicWriteJson, readJson, serialQueue } from './files.mjs';
import { providerUrl } from '../providers/urls.mjs';

export const DEFAULT_SETTINGS = Object.freeze({
  storage: Object.freeze({
    provider: 'local',
    endpoint: '',
    region: 'us-east-1',
    bucket: '',
    prefix: 'folio/',
  }),
  image: Object.freeze({
    endpoint: 'https://api.openai.com/v1/images/generations',
    model: 'gpt-image-1',
  }),
});

function object(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Invalid settings.');
  return value;
}

function text(value, max, blank = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value !== value.trim() ||
    (!blank && !value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error('Invalid settings field.');
  return value;
}

function configuration(input) {
  const source = object(input);
  const storage = object(source.storage);
  const image = object(source.image);
  if (!['local', 's3'].includes(storage.provider)) throw new Error('Invalid storage provider.');
  const endpoint = providerUrl(storage.endpoint, true);
  if (endpoint && new URL(endpoint).search)
    throw new Error('Storage endpoint must not contain a query.');
  const region = text(storage.region, 64);
  if (!/^[a-zA-Z0-9-]+$/.test(region)) throw new Error('Invalid storage region.');
  const bucket = text(storage.bucket, 63, true);
  if (bucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error('Invalid bucket name.');
  let prefix = text(storage.prefix, 512, true);
  if (prefix && !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(prefix))
    throw new Error('Invalid storage prefix.');
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  return {
    storage: { provider: storage.provider, endpoint, region, bucket, prefix },
    image: { endpoint: providerUrl(image.endpoint), model: text(image.model, 128) },
  };
}

function secret(value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error('Invalid credential.');
  return value;
}

function publicSettings(config, secrets) {
  return {
    storage: {
      ...config.storage,
      hasCredentials: Boolean(secrets.accessKeyId && secrets.secretAccessKey),
    },
    image: { ...config.image, hasApiKey: Boolean(secrets.apiKey) },
  };
}

export function createSettingsStore(userData, encryption) {
  const file = join(userData, 'settings.json');
  const run = serialQueue();
  function secureEncryption() {
    if (
      !encryption.isEncryptionAvailable() ||
      encryption.getSelectedStorageBackend?.() === 'basic_text'
    ) {
      throw new Error('Secure operating-system credential storage is unavailable.');
    }
  }
  async function load() {
    let stored;
    try {
      stored = await readJson(file, 64 * 1024);
    } catch (error) {
      if (error.code === 'ENOENT')
        return { config: structuredClone(DEFAULT_SETTINGS), secrets: {} };
      throw error;
    }
    if (stored.version !== 1) throw new Error('Unsupported settings format.');
    const config = configuration(stored);
    let secrets = {};
    if (stored.encryptedSecrets !== undefined) {
      secureEncryption();
      if (
        typeof stored.encryptedSecrets !== 'string' ||
        stored.encryptedSecrets.length > 48 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(stored.encryptedSecrets)
      )
        throw new Error('Invalid encrypted settings.');
      try {
        const decoded = object(
          JSON.parse(encryption.decryptString(Buffer.from(stored.encryptedSecrets, 'base64'))),
        );
        if (decoded.accessKeyId !== undefined || decoded.secretAccessKey !== undefined) {
          secrets.accessKeyId = secret(decoded.accessKeyId);
          secrets.secretAccessKey = secret(decoded.secretAccessKey);
        }
        if (decoded.apiKey !== undefined) secrets.apiKey = secret(decoded.apiKey);
      } catch {
        throw new Error('Stored credentials could not be unlocked.');
      }
    }
    return { config, secrets };
  }
  return {
    flush: () => run(() => {}),
    getSettings: () =>
      run(async () => {
        const { config, secrets } = await load();
        return publicSettings(config, secrets);
      }),
    getPrivateSettings: () =>
      run(async () => {
        const { config, secrets } = await load();
        return { ...config, secrets };
      }),
    async saveSettings(input) {
      const config = configuration(input);
      const storage = input.storage;
      const image = input.image;
      for (const value of [storage.clearCredentials, image.clearApiKey]) {
        if (value !== undefined && typeof value !== 'boolean')
          throw new Error('Invalid credential clearing flag.');
      }
      const suppliedCredentials =
        storage.accessKeyId !== undefined || storage.secretAccessKey !== undefined;
      const accessKeyId = suppliedCredentials ? secret(storage.accessKeyId) : undefined;
      const secretAccessKey = suppliedCredentials ? secret(storage.secretAccessKey) : undefined;
      const apiKey = image.apiKey === undefined ? undefined : secret(image.apiKey);
      const clearCredentials = storage.clearCredentials === true;
      const clearApiKey = image.clearApiKey === true;
      if ((clearCredentials && suppliedCredentials) || (clearApiKey && apiKey !== undefined))
        throw new Error('Cannot clear and replace a credential together.');
      return run(async () => {
        const { secrets } = await load();
        if (clearCredentials) {
          delete secrets.accessKeyId;
          delete secrets.secretAccessKey;
        }
        if (clearApiKey) delete secrets.apiKey;
        if (suppliedCredentials) Object.assign(secrets, { accessKeyId, secretAccessKey });
        if (apiKey !== undefined) secrets.apiKey = apiKey;
        let encryptedSecrets;
        if (Object.keys(secrets).length) {
          secureEncryption();
          try {
            encryptedSecrets = encryption.encryptString(JSON.stringify(secrets)).toString('base64');
          } catch {
            throw new Error('Credentials could not be encrypted.');
          }
        }
        await atomicWriteJson(file, {
          version: 1,
          ...config,
          ...(encryptedSecrets ? { encryptedSecrets } : {}),
        });
        return publicSettings(config, secrets);
      });
    },
  };
}
