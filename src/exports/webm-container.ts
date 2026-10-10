function element(bytes: Uint8Array, offset: number) {
  const start = offset;
  const length = (first: number, maximum: number) => {
    let size = 1;
    while (size <= maximum && !(first & (1 << (8 - size)))) size += 1;
    if (size > maximum) throw new Error('The video recorder returned an invalid WebM container.');
    return size;
  };
  const idLength = length(bytes[offset], 4);
  let id = 0;
  for (let index = 0; index < idLength; index += 1) id = id * 256 + bytes[offset++];
  const sizeLength = length(bytes[offset], 8);
  let size = bytes[offset++] & ((1 << (8 - sizeLength)) - 1);
  let unknown = size === (1 << (8 - sizeLength)) - 1;
  for (let index = 1; index < sizeLength; index += 1) {
    const byte = bytes[offset++];
    unknown &&= byte === 255;
    size = size * 256 + byte;
  }
  const end = unknown ? bytes.length : offset + size;
  if (offset > bytes.length || end > bytes.length || end < offset)
    throw new Error('The video recorder returned a truncated WebM container.');
  return { id, start, data: offset, end, unknown };
}

function sizeBytes(size: number) {
  let length = 1;
  while (size >= 2 ** (7 * length) - 1) length += 1;
  const bytes = new Uint8Array(length);
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = size % 256;
    size = Math.floor(size / 256);
  }
  bytes[0] |= 1 << (8 - length);
  return bytes;
}

export async function finalizeWebm(blob: Blob, durationSeconds: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = element(bytes, 0);
  if (header.id !== 0x1a45dfa3) throw new Error('The recorder did not produce WebM.');
  const segment = element(bytes, header.end);
  if (segment.id !== 0x18538067) throw new Error('The recorder did not produce a WebM segment.');
  let info: ReturnType<typeof element> | undefined;
  for (let offset = segment.data; offset < segment.end;) {
    const item = element(bytes, offset);
    if (item.id === 0x1549a966) {
      info = item;
      break;
    }
    offset = item.end;
  }
  if (!info) throw new Error('The recorder omitted WebM timing information.');
  let scale = 1_000_000;
  const fields: BlobPart[] = [];
  for (let offset = info.data; offset < info.end;) {
    const field = element(bytes, offset);
    if (field.id === 0x2ad7b1) {
      scale = 0;
      for (let index = field.data; index < field.end; index += 1)
        scale = scale * 256 + bytes[index];
    }
    if (field.id !== 0x4489) fields.push(bytes.slice(field.start, field.end));
    offset = field.end;
  }
  if (scale <= 0 || !Number.isFinite(scale))
    throw new Error('The recorder returned invalid WebM timing.');
  const blocks: number[] = [];
  const visit = (start: number, end: number) => {
    for (let offset = start; offset < end;) {
      const item = element(bytes, offset);
      if (item.id === 0x1f43b675) visit(item.data, item.end);
      if (item.id === 0xe7) bytes.fill(0, item.data, item.end);
      if (item.id === 0xa0)
        throw new Error(
          'This recorder uses an unsupported WebM frame layout. Use Animated HTML instead.',
        );
      if (item.id === 0xa3) {
        if (bytes[item.data] !== 0x81 || item.data + 4 > item.end || bytes[item.data + 3] & 6)
          throw new Error('The recorder returned an unsupported WebM frame layout.');
        blocks.push(item.data + 1);
      }
      offset = item.end;
    }
  };
  visit(segment.data, segment.end);
  if (!blocks.length) throw new Error('The recorded WebM contains no video frames.');
  const times = blocks.map((_, index) =>
    Math.round((index * durationSeconds * 1_000_000_000) / scale / blocks.length),
  );
  if (times.at(-1)! > 32767)
    throw new Error('The recorder returned an unsupported WebM time scale.');
  blocks.forEach((timestamp, index) =>
    new DataView(bytes.buffer).setInt16(timestamp, times[index]),
  );
  const duration = new Uint8Array(11);
  duration.set([0x44, 0x89, 0x88]);
  new DataView(duration.buffer).setFloat64(3, (durationSeconds * 1_000_000_000) / scale);
  const content = new Blob([...fields, duration]);
  const infoBlob = new Blob([
    new Uint8Array([0x15, 0x49, 0xa9, 0x66]),
    sizeBytes(content.size),
    content,
  ]);
  const rest = [
    bytes.slice(segment.data, info.start),
    infoBlob,
    bytes.slice(info.end, segment.end),
  ];
  const body = new Blob(rest);
  return new Blob(
    [
      bytes.slice(0, header.end),
      new Uint8Array([0x18, 0x53, 0x80, 0x67]),
      sizeBytes(body.size),
      body,
    ],
    { type: 'video/webm' },
  );
}
