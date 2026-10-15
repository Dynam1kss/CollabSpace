import { afterEach, describe, expect, it } from 'vitest';
import { resetVoice, stopVoice } from './voice-mesh';
import { useVoiceStore } from './voice-store';

afterEach(() => useVoiceStore.getState().reset());

describe('вихід з розмови гасить мовлення', () => {
  it('stopVoice: свій прапорець падає, навіть якщо вийшли посеред слова', () => {
    const store = useVoiceStore.getState();
    store.setInVoice(true);
    store.setSelfSpeaking(true);

    stopVoice();

    // саме тут був баг: stopMeters скасовував цикл вимірювання, а гасив
    // прапорець лише той самий цикл — обідок на своєму стільці висів до
    // перезавантаження сторінки
    expect(useVoiceStore.getState().selfSpeaking).toBe(false);
    expect(useVoiceStore.getState().inVoice).toBe(false);
  });

  it('stopVoice на порожній розмові нічого не ламає', () => {
    useVoiceStore.getState().setSelfSpeaking(true);
    // не в розмові — stopVoice виходить одразу, прапорець лишається чужою
    // справою (його поставив не голос)
    stopVoice();
    expect(useVoiceStore.getState().inVoice).toBe(false);
  });

  it('resetVoice: гасне і своє мовлення, і чуже', () => {
    const store = useVoiceStore.getState();
    store.setInVoice(true);
    store.setSelfSpeaking(true);
    store.setSpeaking(7, true);

    resetVoice();

    expect(useVoiceStore.getState().selfSpeaking).toBe(false);
    expect(useVoiceStore.getState().speaking).toEqual({});
  });
});
