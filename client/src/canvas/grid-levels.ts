// крок опорного рівня в координатах дошки. Решта рівнів — цей крок,
// помножений або поділений на FACTOR потрібну кількість разів
export const BASE_SPACING = 40;
// у скільки разів кожен наступний рівень більший. Ціле — і тому лінії
// рівнів збігаються: кожна лінія грубішого рівня є й на дрібнішому
export const FACTOR = 5;
// з якої екранної щільності рівень починає проявлятись; він же поріг, на
// якому попередній уже розтанув. Рівень живе в [FADE_IN, FADE_IN*FACTOR]
export const FADE_IN_PX = 8;

export interface GridLevels {
  fineSpacing: number;
  fineAlpha: number;
  coarseSpacing: number;
}

// які два рівні показувати на цьому масштабі. Грубіший завжди в повну силу,
// дрібніший проявляється тим більше, чим ближче зум; коли він дозріває,
// нумерація зсувається на один — і всередині нього починає проявлятись
// наступний. Дробова частина «номера рівня» і є прогрес переходу, тому
// перехід плавний, а не стрибок на пороговому зумі
export function gridLevels(scale: number): GridLevels {
  const exact = Math.log(FADE_IN_PX / (BASE_SPACING * scale)) / Math.log(FACTOR);
  const finest = Math.ceil(exact);
  return {
    fineSpacing: BASE_SPACING * FACTOR ** finest,
    fineAlpha: finest - exact,
    coarseSpacing: BASE_SPACING * FACTOR ** (finest + 1),
  };
}

// прозорість лінії, найдрібніший рівень якої має такий крок. Дрібний рівень
// малюється БЕЗ ліній, що належать грубому, тому кожна лінія має рівно одне
// значення — на цьому й тримається плавність переходу.
// Лінія, грубіша за грубий рівень, теж намальована: вона кратна його кроку,
// тож іде разом із ним у повну силу
export function alphaOfSpacing(scale: number, spacing: number): number {
  const { fineSpacing, fineAlpha, coarseSpacing } = gridLevels(scale);
  const fuzz = 1 - 1e-9;
  if (spacing >= coarseSpacing * fuzz) return 1;
  if (spacing >= fineSpacing * fuzz) return fineAlpha;
  return 0;
}
