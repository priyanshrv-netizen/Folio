import { fileURLToPath } from 'node:url';
import { isAbsolute, relative } from 'node:path';

export function rendererRequestAllowed(value, distDirectory, dev) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
  if (dev)
    return (
      ['http:', 'ws:'].includes(url.protocol) && url.hostname === '127.0.0.1' && url.port === '5173'
    );
  if (url.protocol !== 'file:') return false;
  try {
    const path = relative(distDirectory, fileURLToPath(url));
    return (
      path !== '' &&
      !isAbsolute(path) &&
      path !== '..' &&
      !path.startsWith('../') &&
      !path.startsWith('..\\')
    );
  } catch {
    return false;
  }
}
