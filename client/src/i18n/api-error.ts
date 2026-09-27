import { ApiError } from '../api/boards';
import { i18n } from './index';

// текст помилки для людини. сервер шле код і український опис — опис не
// показуємо ніколи, лише перекладений текст за кодом. byCode — коли той самий
// код на цьому місці означає щось конкретніше (INVALID_CREDENTIALS при зміні
// пароля — це саме поточний пароль). fallback — коли коду нема чи він загальний
export function errorText(err: unknown, fallback: string, byCode: Record<string, string> = {}) {
  if (err instanceof ApiError) {
    if (byCode[err.code]) return byCode[err.code];
    if (err.code !== 'VALIDATION_ERROR' && i18n.exists(`errors.${err.code}`))
      return i18n.t(`errors.${err.code}`);
    return fallback;
  }
  // fetch падає TypeError, коли сервера не видно зовсім
  if (err instanceof TypeError) return i18n.t('errors.network');
  return fallback;
}
