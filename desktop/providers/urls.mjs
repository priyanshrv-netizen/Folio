export function providerUrl(value, allowBlank = false) {
  if (allowBlank && value === '') return '';
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    value !== value.trim() ||
    /[\u0000-\u0020\u007f\\]/.test(value)
  ) {
    throw new Error('Provider URL is invalid.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Provider URL is invalid.');
  }
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      'Provider URL must use HTTPS or loopback HTTP, without embedded credentials or a fragment.',
    );
  }
  return url.href;
}
