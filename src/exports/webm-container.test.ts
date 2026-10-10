import { describe, expect, it } from 'vitest';
import { finalizeWebm } from './webm-container';

function fixture(
  options: {
    scale?: number;
    grouped?: boolean;
    track?: number;
    laced?: boolean;
    duration?: boolean;
    noFrames?: boolean;
  } = {},
) {
  const info = [0x2a, 0xd7, 0xb1, 0x83, ...(options.scale === 0 ? [0, 0, 0] : [0x0f, 0x42, 0x40])];
  if (options.duration) info.push(0x44, 0x89, 0x84, 0, 0, 0, 0);
  const block = (time: number) => [
    options.grouped ? 0xa0 : 0xa3,
    0x85,
    options.track ?? 0x81,
    time >> 8,
    time & 255,
    options.laced ? 0x86 : 0x80,
    0x7f,
  ];
  const cluster = [
    0xe7,
    0x81,
    42,
    ...(options.noFrames ? [] : [...block(0), ...block(1492), ...block(1563)]),
  ];
  return new Blob(
    [
      new Uint8Array([
        0x1a,
        0x45,
        0xdf,
        0xa3,
        0x80,
        0x18,
        0x53,
        0x80,
        0x67,
        0xff,
        0x15,
        0x49,
        0xa9,
        0x66,
        0x80 | info.length,
        ...info,
        0x1f,
        0x43,
        0xb6,
        0x75,
        0x80 | cluster.length,
        ...cluster,
      ]),
    ],
    { type: 'video/webm' },
  );
}

describe('MediaRecorder WebM finalization', () => {
  it.each([false, true])(
    'normalizes encoder startup gaps and writes a finite duration (existing: %s)',
    async (duration) => {
      const blob = await finalizeWebm(fixture({ duration }), 1);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const times: number[] = [];
      const durations: number[] = [];
      for (let index = 0; index < bytes.length - 5; index += 1) {
        if (bytes[index] === 0xa3 && bytes[index + 1] === 0x85)
          times.push(new DataView(bytes.buffer).getInt16(index + 3));
        if (bytes[index] === 0x44 && bytes[index + 1] === 0x89)
          durations.push(new DataView(bytes.buffer).getFloat64(index + 3));
        if (bytes[index] === 0xe7 && bytes[index + 1] === 0x81) expect(bytes[index + 2]).toBe(0);
      }
      expect(times).toEqual([0, 333, 667]);
      expect(durations).toEqual([1000]);
      expect(blob.type).toBe('video/webm');
    },
  );

  it.each([
    [{ grouped: true }, /unsupported/],
    [{ track: 0x82 }, /unsupported/],
    [{ laced: true }, /unsupported/],
    [{ noFrames: true }, /no video frames/],
    [{ scale: 0 }, /invalid WebM timing/],
  ] as const)('rejects unsupported or missing frames (%s)', async (options, message) => {
    await expect(finalizeWebm(fixture(options), 1)).rejects.toThrow(message);
  });

  it.each([{ bytes: [] }, { bytes: [1] }, { bytes: [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0] }])(
    'rejects malformed recorder output',
    async ({ bytes }) => {
      await expect(finalizeWebm(new Blob([new Uint8Array(bytes)]), 1)).rejects.toThrow(/WebM/);
    },
  );
});
