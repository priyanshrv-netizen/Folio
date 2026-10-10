import { MAX_IMAGE_BYTES, rasterMime, validateBase64 } from '../persistence/validation.mjs';
import { providerUrl } from './urls.mjs';
import { readBounded, withDeadline } from './network.mjs';

export function createImageProvider(
  settingsStore,
  { fetchImpl = fetch, verifyImage = () => {}, timeoutMs = 90_000 } = {},
) {
  return {
    async generateImage(prompt) {
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) {
        throw new Error('Image prompt must contain between 1 and 8,000 characters.');
      }
      const { image, secrets } = await settingsStore.getPrivateSettings();
      const endpoint = providerUrl(image.endpoint);
      if (!secrets.apiKey && new URL(endpoint).protocol !== 'http:')
        throw new Error('Add an image provider API key first.');
      try {
        return await withDeadline(timeoutMs, async (signal) => {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            signal,
            redirect: 'error',
            credentials: 'omit',
            headers: {
              'Content-Type': 'application/json',
              ...(secrets.apiKey ? { Authorization: `Bearer ${secrets.apiKey}` } : {}),
            },
            body: JSON.stringify({ model: image.model, prompt: prompt.trim(), n: 1 }),
          });
          if (!response.ok || response.status >= 300 || response.redirected)
            throw new Error('Image provider rejected the request.');
          const responseType = response.headers
            .get('content-type')
            ?.split(';', 1)[0]
            .trim()
            .toLowerCase();
          if (responseType !== 'application/json')
            throw new Error('Image provider did not return JSON.');
          const bytes = await readBounded(
            response.body,
            Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024 * 1024,
            signal,
            response.headers.get('content-length'),
          );
          const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          const first = payload?.data?.[0];
          let imageBytes;
          let declaredMime;
          if (first?.b64_json !== undefined) {
            validateBase64(first.b64_json);
            imageBytes = Buffer.from(first.b64_json, 'base64');
          } else if (typeof first?.url === 'string') {
            const url = providerUrl(first.url);
            if (new URL(endpoint).protocol === 'https:' && new URL(url).protocol !== 'https:') {
              throw new Error('Image download must not downgrade to HTTP.');
            }
            const download = await fetchImpl(url, {
              method: 'GET',
              signal,
              redirect: 'error',
              credentials: 'omit',
            });
            if (!download.ok || download.status >= 300 || download.redirected)
              throw new Error('Image download failed.');
            declaredMime = download.headers
              .get('content-type')
              ?.split(';', 1)[0]
              .trim()
              .toLowerCase();
            if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(declaredMime))
              throw new Error('Unsupported image content type.');
            imageBytes = await readBounded(
              download.body,
              MAX_IMAGE_BYTES,
              signal,
              download.headers.get('content-length'),
            );
          } else {
            throw new Error('Image provider returned no image.');
          }
          const mime = rasterMime(imageBytes);
          if (declaredMime && declaredMime !== mime)
            throw new Error('Image content type does not match its bytes.');
          await verifyImage(imageBytes);
          return { dataUrl: `data:${mime};base64,${imageBytes.toString('base64')}` };
        });
      } catch {
        throw new Error(
          'Image generation failed. Check the provider settings, credentials, and connection; the response must contain a raster image under 10 MiB.',
        );
      }
    },
  };
}
