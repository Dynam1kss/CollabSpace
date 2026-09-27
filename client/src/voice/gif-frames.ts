export interface GifFrames {
  frames: ImageBitmap[];
  // кінець кожного кадру від початку циклу, мс — щоб за часом знайти поточний
  ends: number[];
  total: number;
}

// кадри зменшуємо відразу до квадрата стільця: 60 кадрів 480×480 — це
// десятки мегабайт, а 96×96 — ~2мб. 96 вистачає на 36px стільця при dpr 2–3
const FRAME_SIZE = 96;
// гіф на кілька сотень кадрів аватаром не буде, а памʼять треба обмежити
const MAX_FRAMES = 120;
// браузери показують кадри з нульовою затримкою як ~100мс; менше 20 — теж
const MIN_FRAME_MS = 20;

// одна людина може сидіти в кількох вкладках — декодуємо раз на url
const cache = new Map<string, Promise<GifFrames | null>>();

// null — браузер без ImageDecoder (тоді стілець лишається з першим кадром)
export function loadGifFrames(url: string): Promise<GifFrames | null> {
  if (typeof ImageDecoder === 'undefined') return Promise.resolve(null);
  let pending = cache.get(url);
  if (!pending) {
    pending = decode(url).catch(() => null);
    cache.set(url, pending);
  }
  return pending;
}

async function decode(url: string): Promise<GifFrames> {
  const res = await fetch(url);
  const decoder = new ImageDecoder({ data: await res.arrayBuffer(), type: 'image/gif' });
  await decoder.tracks.ready;
  const count = Math.min(decoder.tracks.selectedTrack?.frameCount ?? 1, MAX_FRAMES);
  const frames: ImageBitmap[] = [];
  const ends: number[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    // gif не кадрується — беремо центральний квадрат, як object-fit: cover
    const side = Math.min(image.displayWidth, image.displayHeight);
    frames.push(
      await createImageBitmap(
        image,
        (image.displayWidth - side) / 2,
        (image.displayHeight - side) / 2,
        side,
        side,
        { resizeWidth: FRAME_SIZE, resizeHeight: FRAME_SIZE, resizeQuality: 'medium' },
      ),
    );
    // duration у мікросекундах
    total += Math.max(MIN_FRAME_MS, (image.duration ?? 100_000) / 1000);
    ends.push(total);
    image.close();
  }
  decoder.close();
  return { frames, ends, total };
}

export function frameAt(gif: GifFrames, now: number) {
  const t = now % gif.total;
  const i = gif.ends.findIndex((end) => t < end);
  return gif.frames[i === -1 ? gif.frames.length - 1 : i];
}
