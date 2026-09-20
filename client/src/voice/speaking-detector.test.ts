import { describe, expect, it } from 'vitest';
import {
  IDLE_SPEAKING,
  SPEAKING_HOLD_MS,
  SPEAKING_RMS_THRESHOLD,
  nextSpeakingState,
  rmsLevel,
} from './speaking-detector';

// getByteTimeDomainData віддає 0..255 з тишею на 128
const silence = (n = 512) => new Uint8Array(n).fill(128);
const tone = (amplitude: number, n = 512) =>
  Uint8Array.from({ length: n }, (_, i) => 128 + Math.round(Math.sin((i / n) * Math.PI * 16) * 127 * amplitude));

describe('рівень сигналу', () => {
  it('тиша — нуль', () => {
    expect(rmsLevel(silence())).toBe(0);
  });

  it('порожній буфер не ділить на нуль', () => {
    expect(rmsLevel(new Uint8Array(0))).toBe(0);
  });

  it('гучніший сигнал дає більший рівень', () => {
    expect(rmsLevel(tone(0.5))).toBeGreaterThan(rmsLevel(tone(0.1)));
  });

  it('шум на рівні тиші не дотягує до порога, звичайна мова — дотягує', () => {
    // ±1 крок від 128 — це приблизно те, що дає мовчазний мікрофон
    expect(rmsLevel(tone(0.004))).toBeLessThan(SPEAKING_RMS_THRESHOLD);
    expect(rmsLevel(tone(0.1))).toBeGreaterThan(SPEAKING_RMS_THRESHOLD);
  });
});

describe('утримання стану', () => {
  const loud = SPEAKING_RMS_THRESHOLD * 3;
  const quiet = SPEAKING_RMS_THRESHOLD / 10;

  it('починає говорити одразу, без затримки', () => {
    expect(nextSpeakingState(IDLE_SPEAKING, loud, 1000).speaking).toBe(true);
  });

  it('коротка пауза між словами індикатор не гасить', () => {
    let state = nextSpeakingState(IDLE_SPEAKING, loud, 0);
    // 200мс тиші — звичайний проміжок між словами
    for (let t = 16; t <= 200; t += 16) {
      state = nextSpeakingState(state, quiet, t);
      expect(state.speaking).toBe(true);
    }
  });

  it('після довшої тиші гасне', () => {
    let state = nextSpeakingState(IDLE_SPEAKING, loud, 0);
    state = nextSpeakingState(state, quiet, SPEAKING_HOLD_MS - 1);
    expect(state.speaking).toBe(true);
    state = nextSpeakingState(state, quiet, SPEAKING_HOLD_MS);
    expect(state.speaking).toBe(false);
  });

  it('нове слово під час утримання продовжує його', () => {
    let state = nextSpeakingState(IDLE_SPEAKING, loud, 0);
    state = nextSpeakingState(state, quiet, 300);
    state = nextSpeakingState(state, loud, 320); // заговорив знову
    state = nextSpeakingState(state, quiet, 600); // 280мс від останнього звуку
    expect(state.speaking).toBe(true);
  });

  it('ціла фраза з паузами не миготить жодного разу', () => {
    // 0..300 говорить, 300..500 пауза, 500..900 говорить, далі тиша
    let state = IDLE_SPEAKING;
    const flips: number[] = [];
    for (let t = 0; t <= 1600; t += 16) {
      const talking = t < 300 || (t >= 500 && t < 900);
      const before = state.speaking;
      state = nextSpeakingState(state, talking ? loud : quiet, t);
      if (state.speaking !== before) flips.push(t);
    }
    // рівно два перемикання: зайнявся на початку й згас у кінці
    expect(flips).toHaveLength(2);
    expect(flips[0]).toBe(0);
    // останній гучний кадр — 896 (сітка по 16мс), від нього й рахуємо
    const lastLoud = 896;
    expect(flips[1]).toBeGreaterThanOrEqual(lastLoud + SPEAKING_HOLD_MS);
    expect(flips[1]).toBeLessThan(lastLoud + SPEAKING_HOLD_MS + 16);
  });

  it('тиша від початку не вмикає нічого', () => {
    let state = IDLE_SPEAKING;
    for (let t = 0; t <= 2000; t += 16) state = nextSpeakingState(state, quiet, t);
    expect(state.speaking).toBe(false);
  });

  it('вимкнений мікрофон дає рівно нуль — і жодного «говорить»', () => {
    const state = nextSpeakingState(IDLE_SPEAKING, rmsLevel(silence()), 500);
    expect(state.speaking).toBe(false);
  });
});
