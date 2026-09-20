// Поріг гучності, з якого вважаємо, що людина говорить. Рівень — RMS від
// -1..1, тобто 0.02 це приблизно 2% від максимуму. Підібрано так: тиша в
// кімнаті й шум мікрофона дають 0.001–0.005, звичайна мова — 0.03–0.15.
// 0.02 лягає між ними з запасом в обидва боки
export const SPEAKING_RMS_THRESHOLD = 0.02;

// Скільки тримаємо позначку «говорить» після того, як сигнал упав нижче
// порога. Паузи між словами — 100–250мс, між реченнями — від 400мс. 350
// перекриває перші (щоб індикатор не миготів посеред фрази) і не перекриває
// другі (щоб гаснув, коли людина справді замовкла).
// Наростання без затримки: почав говорити — видно одразу
export const SPEAKING_HOLD_MS = 350;

// скільки байтів беремо за раз. 512 семплів — близько 10мс на 48кГц:
// достатньо для стабільного RMS і дешево читати
export const ANALYSER_FFT_SIZE = 512;

// середньоквадратичний рівень із часової форми сигналу. getByteTimeDomainData
// віддає 0..255 із тишею на 128, тому спершу зводимо до -1..1.
// Часова форма, а не спектр: нам потрібна саме гучність, і на неї не впливає
// ні згладжування аналізатора, ні розподіл по частотах
export function rmsLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    const value = (sample - 128) / 128;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export interface SpeakingState {
  speaking: boolean;
  // коли востаннє сигнал був вище порога — від цього рахується утримання
  loudAt: number;
}

export const IDLE_SPEAKING: SpeakingState = { speaking: false, loudAt: 0 };

// перехід стану на цьому кадрі. Вгору — одразу, вниз — тільки коли тиша
// протрималась довше за SPEAKING_HOLD_MS
export function nextSpeakingState(
  prev: SpeakingState,
  level: number,
  now: number,
  threshold = SPEAKING_RMS_THRESHOLD,
  holdMs = SPEAKING_HOLD_MS,
): SpeakingState {
  if (level >= threshold) return { speaking: true, loudAt: now };
  if (!prev.speaking) return prev.loudAt === 0 ? prev : { speaking: false, loudAt: prev.loudAt };
  return now - prev.loudAt >= holdMs ? { speaking: false, loudAt: prev.loudAt } : prev;
}
