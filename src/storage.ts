import type { AppSettings, DesignDocument, FolioBridge } from './types';
import { validateDocument } from './model';

export const defaultSettings: AppSettings = {
  storage: {
    provider: 'local',
    endpoint: '',
    region: 'us-east-1',
    bucket: '',
    prefix: 'folio/',
    hasCredentials: false,
  },
  image: {
    endpoint: 'https://api.openai.com/v1/images/generations',
    model: 'gpt-image-1',
    hasApiKey: false,
  },
};

let database: Promise<IDBDatabase> | undefined;

function db() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('folio-studio', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error('Could not open local storage. Your browser may have disabled IndexedDB.'));
  });
  return database;
}

async function store<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('documents', mode);
    const request = action(transaction.objectStore('documents'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () =>
      reject(
        new Error('Local save failed. Storage may be full; export your document to keep a copy.'),
      );
    transaction.onabort = () => reject(new Error('Local storage operation was interrupted.'));
  });
}

function desktopOnly(): never {
  throw new Error(
    'Open the desktop app to use encrypted credentials and cloud providers. Run npm run desktop.',
  );
}

const browserBridge: FolioBridge = {
  async listDocuments() {
    const documents = await store<DesignDocument[]>('readonly', (store) => store.getAll());
    return documents
      .map(({ id, name, updatedAt, pages }) => ({
        id,
        name,
        updatedAt,
        pageCount: pages.length,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async loadDocument(id) {
    const document = await store('readonly', (store) => store.get(id));
    if (!document) throw new Error('This document could not be found in local storage.');
    return validateDocument(document);
  },
  async saveDocument(document) {
    await store('readwrite', (store) => store.put(validateDocument(document)));
  },
  async getSettings() {
    return structuredClone(defaultSettings);
  },
  async saveSettings() {
    return desktopOnly();
  },
  async syncDocument() {
    return desktopOnly();
  },
  async listCloudDocuments() {
    return desktopOnly();
  },
  async loadCloudDocument() {
    return desktopOnly();
  },
  async generateImage() {
    return desktopOnly();
  },
};

export const storage = window.folio ?? browserBridge;
export const isDesktop = Boolean(window.folio);
