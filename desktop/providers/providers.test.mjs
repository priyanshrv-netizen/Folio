import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { createCloudProvider } from './s3.mjs';
import { createImageProvider } from './images.mjs';
import { providerUrl } from './urls.mjs';
import { MAX_IMAGE_BYTES, MAX_DOCUMENT_BYTES } from '../persistence/validation.mjs';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const document = (id = 'doc-1') => ({
  schemaVersion: 1,
  id,
  name: 'Cloud document',
  pages: [{ id: 'page-1', name: 'Page', nodes: [] }],
  activePageId: 'page-1',
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
});
const settings = (overrides = {}) => ({
  storage: {
    provider: 's3',
    endpoint: '',
    region: 'us-east-1',
    bucket: 'test-bucket',
    prefix: 'folio/',
  },
  image: { endpoint: 'https://images.example.test/generate', model: 'gpt-image-1' },
  secrets: {
    accessKeyId: 'FAKE_ACCESS',
    secretAccessKey: 'FAKE_SECRET',
    apiKey: 'FAKE_IMAGE_TOKEN',
  },
  ...overrides,
});
const store = (value) => ({ getPrivateSettings: vi.fn(async () => value ?? settings()) });
const body = (value) => ({
  Body: Readable.from([JSON.stringify(value)]),
  ContentLength: Buffer.byteLength(JSON.stringify(value)),
});

describe('S3-compatible cloud provider', () => {
  function setup(send, overrides) {
    const client = { send: vi.fn(send), destroy: vi.fn() };
    const clientFactory = vi.fn(() => client);
    return {
      client,
      clientFactory,
      provider: createCloudProvider(store(overrides), { clientFactory }),
    };
  }

  it('does not connect until explicitly invoked and pushes only a Folio document', async () => {
    const { clientFactory, client, provider } = setup(async () => ({}));
    expect(clientFactory).not.toHaveBeenCalled();
    expect(await provider.syncDocument(document())).toEqual({ key: 'folio/doc-1.folio.json' });
    const [command, options] = client.send.mock.calls[0];
    expect(command.constructor.name).toBe('PutObjectCommand');
    expect(command.input.Bucket).toBe('test-bucket');
    expect(JSON.parse(command.input.Body)).toEqual(document());
    expect(command.input.ContentType).toBe('application/json');
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(clientFactory.mock.calls[0][0]).not.toHaveProperty('endpoint');
    expect(clientFactory.mock.calls[0][0].followRegionRedirects).toBe(false);
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it('configures path-style R2 credentials in main process only', async () => {
    const config = settings();
    Object.assign(config.storage, {
      endpoint: 'https://account.r2.cloudflarestorage.com/',
      region: 'auto',
    });
    const { clientFactory, provider } = setup(async () => body(document()), config);
    expect(await provider.loadCloudDocument('doc-1')).toEqual(document());
    expect(clientFactory.mock.calls[0][0]).toMatchObject({
      endpoint: config.storage.endpoint,
      region: 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: 'FAKE_ACCESS', secretAccessKey: 'FAKE_SECRET' },
    });
  });

  it('lists paginated own-format documents and ignores invalid keys, JSON and mismatched IDs', async () => {
    const { provider, client } = setup(async (command) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        if (!command.input.ContinuationToken)
          return {
            IsTruncated: true,
            NextContinuationToken: 'page-2',
            Contents: [
              { Key: 'folio/doc-1.folio.json' },
              { Key: 'outside/doc-2.folio.json' },
              { Key: 'folio/../../escape.folio.json' },
              { Key: 'folio/image.png' },
            ],
          };
        return {
          Contents: [
            { Key: 'folio/invalid.folio.json' },
            { Key: 'folio/mismatch.folio.json' },
            { Key: 'folio/doc-2.folio.json' },
          ],
        };
      }
      if (command.input.Key.includes('invalid')) return body({ invalid: true });
      if (command.input.Key.includes('mismatch')) return body(document('different'));
      return body(document(command.input.Key.includes('doc-2') ? 'doc-2' : 'doc-1'));
    });
    const summaries = await provider.listCloudDocuments();
    expect(summaries.map((value) => value.id)).toEqual(['doc-1', 'doc-2']);
    expect(summaries[0].pageCount).toBe(1);
    expect(
      client.send.mock.calls.every(
        ([command]) => command.constructor.name !== 'DeleteObjectCommand',
      ),
    ).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(6);
  });

  it('validates before calling the SDK', async () => {
    const { provider, clientFactory } = setup(async () => ({}));
    await expect(provider.syncDocument({ ...document(), pages: [] })).rejects.toThrow();
    await expect(provider.loadCloudDocument('../escape')).rejects.toThrow();
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('requires explicit storage configuration and never uses ambient credentials', async () => {
    const config = settings({ secrets: {} });
    const { provider, clientFactory } = setup(async () => ({}), config);
    await expect(provider.listCloudDocuments()).rejects.toThrow(/Configure/);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it.each([
    async () => {
      throw new Error('FAKE_SECRET raw signed URL');
    },
    async () => body(document('mismatched')),
    async () => ({ Body: Readable.from(['{}']), ContentLength: MAX_DOCUMENT_BYTES + 1 }),
    async () => body({ schemaVersion: 999 }),
  ])('sanitizes failed or invalid downloads', async (send) => {
    const { provider, client } = setup(send);
    await expect(provider.loadCloudDocument('doc-1')).rejects.toThrow(
      'Cloud request failed. Check the endpoint, bucket, region, credentials, and connection.',
    );
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it('rejects repeated pagination tokens instead of looping', async () => {
    const { provider, client } = setup(async () => ({
      IsTruncated: true,
      NextContinuationToken: 'same',
      Contents: [],
    }));
    await expect(provider.listCloudDocuments()).rejects.toThrow(/Cloud request failed/);
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('times out and destroys an unresponsive client', async () => {
    const client = { send: vi.fn(() => new Promise(() => {})), destroy: vi.fn() };
    const provider = createCloudProvider(store(), { clientFactory: () => client, timeoutMs: 10 });
    await expect(provider.loadCloudDocument('doc-1')).rejects.toThrow(/Cloud request failed/);
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it('uses the real SDK against a loopback fixture for explicit put, list and get', async () => {
    const requests = [];
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push({
        method: request.method,
        url: request.url,
        body: Buffer.concat(chunks).toString('utf8'),
        authorization: request.headers.authorization,
      });
      if (request.method === 'PUT') {
        response.writeHead(200, { ETag: '"fixture"' });
        response.end();
      } else if (request.url.includes('list-type=2')) {
        response.writeHead(200, { 'Content-Type': 'application/xml' });
        response.end(
          `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><Contents><Key>folio/doc-1.folio.json</Key><Size>${JSON.stringify(document()).length}</Size></Contents></ListBucketResult>`,
        );
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(document()));
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const config = settings();
      config.storage.endpoint = `http://127.0.0.1:${server.address().port}`;
      const provider = createCloudProvider(store(config));
      await provider.syncDocument(document());
      expect((await provider.listCloudDocuments())[0].id).toBe('doc-1');
      expect(await provider.loadCloudDocument('doc-1')).toEqual(document());
      expect(requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'GET', 'GET']);
      expect(requests[0].url).toContain('/test-bucket/folio/doc-1.folio.json');
      expect(JSON.parse(requests[0].body)).toEqual(document());
      expect(requests[0].authorization).toContain('AWS4-HMAC-SHA256');
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('OpenAI-compatible generation', () => {
  it('sends one explicit model/prompt/n request and validates base64 bytes', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ b64_json: png }] }));
    const verifyImage = vi.fn();
    const provider = createImageProvider(store(), { fetchImpl, verifyImage });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await provider.generateImage('  Soft purple mountains  ')).toEqual({
      dataUrl: `data:image/png;base64,${png}`,
    });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(settings().image.endpoint);
    expect(JSON.parse(options.body)).toEqual({
      model: 'gpt-image-1',
      prompt: 'Soft purple mountains',
      n: 1,
    });
    expect(options.headers.Authorization).toBe('Bearer FAKE_IMAGE_TOKEN');
    expect(options.redirect).toBe('error');
    expect(options.credentials).toBe('omit');
    expect(verifyImage).toHaveBeenCalledWith(Buffer.from(png, 'base64'));
  });

  it('downloads image URLs without forwarding authorization or cookies', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [{ url: 'https://cdn.example.test/image' }] }))
      .mockResolvedValueOnce(
        new Response(Buffer.from(png, 'base64'), { headers: { 'Content-Type': 'image/png' } }),
      );
    const result = await createImageProvider(store(), { fetchImpl }).generateImage('An image');
    expect(result.dataUrl).toBe(`data:image/png;base64,${png}`);
    expect(fetchImpl.mock.calls[1][1]).not.toHaveProperty('headers');
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      method: 'GET',
    });
  });

  it.each([
    () => Response.json({ error: 'FAKE_IMAGE_TOKEN' }, { status: 401 }),
    () => Response.json({ data: [{ b64_json: 'not base64' }] }),
    () => Response.json({ data: [{ b64_json: Buffer.from('<svg/>').toString('base64') }] }),
    () => Response.json({ data: [] }),
    () => Response.json({ data: [{ url: 'file:///private/file' }] }),
    () => Response.json({ data: [{ url: 'https://user:pass@example.test/image' }] }),
    () => Response.json({ data: [{ url: 'http://127.0.0.1/image' }] }),
    () =>
      new Response('redirect', { status: 302, headers: { Location: 'https://elsewhere.test' } }),
    () =>
      new Response('bad', {
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(2 * MAX_IMAGE_BYTES),
        },
      }),
  ])('sanitizes invalid image responses', async (response) => {
    const fetchImpl = vi.fn(async () => response());
    await expect(
      createImageProvider(store(), { fetchImpl }).generateImage('An image'),
    ).rejects.toThrow(/^Image generation failed\./);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects MIME mismatch and oversized streamed images', async () => {
    for (const download of [
      new Response(Buffer.from(png, 'base64'), { headers: { 'Content-Type': 'image/jpeg' } }),
      new Response(Buffer.alloc(MAX_IMAGE_BYTES + 1), { headers: { 'Content-Type': 'image/png' } }),
    ]) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ data: [{ url: 'https://cdn.example.test/image' }] }))
        .mockResolvedValueOnce(download);
      await expect(
        createImageProvider(store(), { fetchImpl }).generateImage('An image'),
      ).rejects.toThrow(/^Image generation failed\./);
    }
  });

  it('rejects failed native decoding and does not surface raw provider errors', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ b64_json: png }] }));
    await expect(
      createImageProvider(store(), {
        fetchImpl,
        verifyImage: () => {
          throw new Error('bad decoder FAKE_IMAGE_TOKEN');
        },
      }).generateImage('An image'),
    ).rejects.toThrow(/^Image generation failed\./);
    fetchImpl.mockRejectedValueOnce(new Error('FAKE_IMAGE_TOKEN'));
    await expect(
      createImageProvider(store(), { fetchImpl }).generateImage('An image'),
    ).rejects.toThrow(/^Image generation failed\./);
  });

  it('validates prompts before requests and times out unresponsive providers', async () => {
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const provider = createImageProvider(store(), { fetchImpl, timeoutMs: 10 });
    for (const prompt of ['', '   ', 'x'.repeat(8001), 10])
      await expect(provider.generateImage(prompt)).rejects.toThrow(/prompt/);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(provider.generateImage('An image')).rejects.toThrow(/^Image generation failed\./);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('supports unauthenticated localhost fixture servers without external requests', async () => {
    let received;
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      received = { body: JSON.parse(Buffer.concat(chunks)), auth: request.headers.authorization };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ b64_json: png }] }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const config = settings({
        image: { endpoint: `http://127.0.0.1:${server.address().port}/generate`, model: 'fixture' },
        secrets: {},
      });
      const result = await createImageProvider(store(config)).generateImage('Fixture');
      expect(result.dataUrl).toContain(png);
      expect(received).toEqual({
        body: { model: 'fixture', prompt: 'Fixture', n: 1 },
        auth: undefined,
      });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('provider URL policy', () => {
  it.each([
    'https://example.test/image',
    'http://localhost:1234/image',
    'http://127.0.0.1:1234/image',
    'http://[::1]:1234/image',
  ])('accepts %s', (url) => {
    expect(providerUrl(url)).toBe(url);
  });
  it.each([
    'http://example.test/image',
    'http://localhost.evil.test/image',
    'https://a:b@example.test',
    'file:///a',
    'javascript:alert(1)',
    ' https://example.test',
    'https://example.test/#token',
  ])('rejects %s', (url) => {
    expect(() => providerUrl(url)).toThrow();
  });
});
