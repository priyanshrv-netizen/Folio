export async function withDeadline(milliseconds, operation) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Provider request timed out.'));
        }, milliseconds);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function readBounded(body, maxBytes, signal, contentLength) {
  if (contentLength !== undefined && contentLength !== null && contentLength !== '') {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      body?.destroy?.();
      await body?.cancel?.().catch(() => {});
      throw new Error('Provider response exceeds its size limit.');
    }
  }
  if (!body || !body[Symbol.asyncIterator]) throw new Error('Provider returned no readable data.');
  const chunks = [];
  let length = 0;
  const abort = () => body.destroy?.(new Error('Provider request timed out.'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of body) {
      if (signal.aborted) throw new Error('Provider request timed out.');
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > maxBytes) throw new Error('Provider response exceeds its size limit.');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, length);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
