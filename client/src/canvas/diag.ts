// журнал життєвого циклу дошки. Увімкнений завжди й навмисно докладний:
// втрата обʼєктів (журнал 20.09) відтворювалась рідко, і єдиний спосіб її
// зловити — мати в консолі повну послідовність подій із часом і кількістю
// обʼєктів на кожному кроці
const started = performance.now();

export function diag(event: string, data: Record<string, unknown> = {}) {
  console.info(`[boardsync-diag] +${Math.round(performance.now() - started)}ms ${event}`, data);
}

// те, що ніколи не має статись. Окремо, щоб не загубилось серед звичайних
export function diagAlarm(event: string, data: Record<string, unknown> = {}) {
  console.error(`[boardsync-diag] ТРИВОГА ${new Date().toISOString()} ${event}`, data);
}
