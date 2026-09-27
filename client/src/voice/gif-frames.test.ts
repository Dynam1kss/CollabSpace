import { describe, expect, it } from 'vitest';
import { frameAt } from './gif-frames';
import type { GifFrames } from './gif-frames';

describe('frameAt', () => {
  const a = {} as ImageBitmap;
  const b = {} as ImageBitmap;
  const c = {} as ImageBitmap;
  // кадри по 100, 50 і 200 мс
  const gif: GifFrames = { frames: [a, b, c], ends: [100, 150, 350], total: 350 };

  it('кадр за часом від початку циклу, по колу', () => {
    expect(frameAt(gif, 0)).toBe(a);
    expect(frameAt(gif, 99)).toBe(a);
    expect(frameAt(gif, 100)).toBe(b);
    expect(frameAt(gif, 149)).toBe(b);
    expect(frameAt(gif, 150)).toBe(c);
    expect(frameAt(gif, 349)).toBe(c);
    expect(frameAt(gif, 350)).toBe(a);
    expect(frameAt(gif, 350 * 7 + 120)).toBe(b);
  });
});
