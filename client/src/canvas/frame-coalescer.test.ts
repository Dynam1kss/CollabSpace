import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameCoalescer } from './frame-coalescer';
import { setSyncStrategy } from './sync-strategy';

const nextFrame = () => new Promise<void>((r) => queueMicrotask(r));

afterEach(() => setSyncStrategy('batched'));

describe('frameCoalescer', () => {
  it('batched: пʼять подій за кадр — одне виконання, останньої дії', async () => {
    const c = frameCoalescer();
    const seen: number[] = [];
    for (let i = 1; i <= 5; i++) c.schedule(() => seen.push(i));
    expect(seen).toEqual([]);
    await nextFrame();
    expect(seen).toEqual([5]);
    // наступний кадр — знову одне
    c.schedule(() => seen.push(6));
    c.schedule(() => seen.push(7));
    await nextFrame();
    expect(seen).toEqual([5, 7]);
  });

  it('flush виконує відкладене одразу і вдруге в кадрі не повторює', async () => {
    const c = frameCoalescer();
    const fn = vi.fn();
    c.schedule(fn);
    c.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    await nextFrame();
    expect(fn).toHaveBeenCalledTimes(1);
    c.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('per-event: кожна подія виконується одразу', () => {
    setSyncStrategy('per-event');
    const c = frameCoalescer();
    const fn = vi.fn();
    for (let i = 0; i < 5; i++) c.schedule(fn);
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
