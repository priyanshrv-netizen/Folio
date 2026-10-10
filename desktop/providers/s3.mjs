import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import {
  MAX_DOCUMENT_BYTES,
  documentSummary,
  validateDocument,
  validateId,
} from '../persistence/validation.mjs';
import { readBounded, withDeadline } from './network.mjs';

export function createCloudProvider(
  settingsStore,
  { clientFactory = (options) => new S3Client(options), timeoutMs = 60_000 } = {},
) {
  async function request(operation) {
    const { storage, secrets } = await settingsStore.getPrivateSettings();
    if (
      storage.provider !== 's3' ||
      !storage.bucket ||
      !secrets.accessKeyId ||
      !secrets.secretAccessKey
    ) {
      throw new Error(
        'Configure an S3-compatible bucket and credentials before using cloud backup.',
      );
    }
    let client;
    try {
      client = clientFactory({
        ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
        region: storage.region,
        credentials: { accessKeyId: secrets.accessKeyId, secretAccessKey: secrets.secretAccessKey },
        forcePathStyle: Boolean(storage.endpoint),
        followRegionRedirects: false,
        maxAttempts: 1,
        requestHandler: {
          connectionTimeout: 10_000,
          requestTimeout: timeoutMs,
          throwOnRequestTimeout: true,
        },
      });
      return await withDeadline(timeoutMs, (signal) => operation(client, storage, signal));
    } catch {
      throw new Error(
        'Cloud request failed. Check the endpoint, bucket, region, credentials, and connection.',
      );
    } finally {
      client?.destroy();
    }
  }
  const keyFor = (prefix, id) => `${prefix}${validateId(id)}.folio.json`;
  async function getDocument(client, storage, signal, id, budget = MAX_DOCUMENT_BYTES) {
    const result = await client.send(
      new GetObjectCommand({ Bucket: storage.bucket, Key: keyFor(storage.prefix, id) }),
      { abortSignal: signal },
    );
    const bytes = await readBounded(
      result.Body,
      Math.min(MAX_DOCUMENT_BYTES, budget),
      signal,
      result.ContentLength,
    );
    const document = validateDocument(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (document.id !== id) throw new Error('Cloud document ID does not match its key.');
    return { document, bytes: bytes.length };
  }
  return {
    async syncDocument(input) {
      const document = validateDocument(input);
      const body = JSON.stringify(document);
      return request(async (client, storage, signal) => {
        const key = keyFor(storage.prefix, document.id);
        await client.send(
          new PutObjectCommand({
            Bucket: storage.bucket,
            Key: key,
            Body: body,
            ContentType: 'application/json',
            Metadata: { 'folio-schema': '1' },
          }),
          { abortSignal: signal },
        );
        return { key };
      });
    },
    async loadCloudDocument(id) {
      validateId(id);
      return request(
        async (client, storage, signal) =>
          (await getDocument(client, storage, signal, id)).document,
      );
    },
    async listCloudDocuments() {
      return request(async (client, storage, signal) => {
        const ids = new Set();
        const tokens = new Set();
        let token;
        for (let page = 0; ; page += 1) {
          if (page >= 10) throw new Error('Cloud listing exceeded its limit.');
          const result = await client.send(
            new ListObjectsV2Command({
              Bucket: storage.bucket,
              Prefix: storage.prefix,
              MaxKeys: 1000,
              ...(token ? { ContinuationToken: token } : {}),
            }),
            { abortSignal: signal },
          );
          for (const item of result.Contents ?? []) {
            if (
              typeof item.Key !== 'string' ||
              !item.Key.startsWith(storage.prefix) ||
              (item.Size !== undefined &&
                (!Number.isSafeInteger(item.Size) ||
                  item.Size > MAX_DOCUMENT_BYTES ||
                  item.Size < 0))
            )
              continue;
            const match = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\.folio\.json$/.exec(
              item.Key.slice(storage.prefix.length),
            );
            if (match) ids.add(match[1]);
            if (ids.size > 500) throw new Error('Cloud listing exceeded its limit.');
          }
          if (!result.IsTruncated) break;
          token = result.NextContinuationToken;
          if (typeof token !== 'string' || !token || tokens.has(token))
            throw new Error('Invalid cloud listing continuation.');
          tokens.add(token);
        }
        const summaries = [];
        let remaining = 128 * 1024 * 1024;
        for (const id of ids) {
          if (remaining <= 0) throw new Error('Cloud listing exceeded its byte limit.');
          const result = await client.send(
            new GetObjectCommand({ Bucket: storage.bucket, Key: keyFor(storage.prefix, id) }),
            { abortSignal: signal },
          );
          const bytes = await readBounded(
            result.Body,
            Math.min(MAX_DOCUMENT_BYTES, remaining),
            signal,
            result.ContentLength,
          );
          remaining -= bytes.length;
          try {
            const document = validateDocument(
              JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
            );
            if (document.id === id) summaries.push(documentSummary(document));
          } catch {}
        }
        return summaries.sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
        );
      });
    },
  };
}
