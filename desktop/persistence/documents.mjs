import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson, readJson, serialQueue } from './files.mjs';
import {
  MAX_DOCUMENT_BYTES,
  documentSummary,
  validateDocument,
  validateId,
} from './validation.mjs';

function filename(id) {
  validateId(id);
  return `${createHash('sha256').update(id).digest('hex')}.folio.json`;
}

export function createDocumentStore(userData) {
  const directory = join(userData, 'documents');
  const run = serialQueue();
  return {
    flush: () => run(() => {}),
    async saveDocument(input) {
      const document = validateDocument(input);
      return run(() => atomicWriteJson(join(directory, filename(document.id)), document));
    },
    async loadDocument(id) {
      const file = join(directory, filename(id));
      return run(async () => {
        const document = validateDocument(await readJson(file, MAX_DOCUMENT_BYTES));
        if (document.id !== id) throw new Error('Document ID does not match.');
        return document;
      });
    },
    listDocuments() {
      return run(async () => {
        let entries;
        try {
          entries = await readdir(directory, { withFileTypes: true });
        } catch (error) {
          if (error.code === 'ENOENT') return [];
          throw error;
        }
        const summaries = [];
        for (const entry of entries) {
          if (!entry.isFile() || !/^[a-f0-9]{64}\.folio\.json$/.test(entry.name)) continue;
          try {
            const document = validateDocument(
              await readJson(join(directory, entry.name), MAX_DOCUMENT_BYTES),
            );
            if (filename(document.id) === entry.name) summaries.push(documentSummary(document));
          } catch {}
        }
        return summaries.sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
        );
      });
    },
  };
}
