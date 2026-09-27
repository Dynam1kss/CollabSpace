import { afterEach, describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
import { gifsWatched, watchGif } from './gif-ticker';

const fakeLayer = () =>
  ({ batchDraw: vi.fn() }) as unknown as Konva.Layer & { batchDraw: ReturnType<typeof vi.fn> };

afterEach(() => {
  vi.useRealTimers();
});

describe('gif-ticker', () => {
  it('кадр не змінився — шар не перемальовується', () => {
    vi.useFakeTimers();
    const layer = fakeLayer();
    const stop = watchGif(layer, () => false);
    vi.advanceTimersByTime(500);
    expect(layer.batchDraw).not.toHaveBeenCalled();
    stop();
  });

  it('гортає кадри, поки є хоч один gif-стілець, і зупиняється з останнім', () => {
    vi.useFakeTimers();
    const layer = fakeLayer();
    const tickA = vi.fn(() => true);
    const tickB = vi.fn(() => true);
    const stopA = watchGif(layer, tickA);
    const stopB = watchGif(layer, tickB);
    vi.advanceTimersByTime(175);
    // два стільці на одному шарі — кадри міняються обом, а малюється шар раз
    expect(tickA).toHaveBeenCalledTimes(3);
    expect(tickB).toHaveBeenCalledTimes(3);
    expect(layer.batchDraw).toHaveBeenCalledTimes(3);

    stopA();
    vi.advanceTimersByTime(100);
    expect(tickA).toHaveBeenCalledTimes(3);
    expect(layer.batchDraw).toHaveBeenCalledTimes(5);

    stopB();
    expect(gifsWatched()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(layer.batchDraw).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});
