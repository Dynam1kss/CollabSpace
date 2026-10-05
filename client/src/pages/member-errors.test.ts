import { describe, expect, it } from 'vitest';
import { isLostBoardRights, MEMBER_ERROR } from 'shared';
import { uk } from '../i18n/uk';

// 05.10: панель учасників вирішувала «я втратив права» за http-статусом, і
// «немає користувача з такою поштою» (404) ховало панель власнику. Тепер
// вирішує код, і таких кодів рівно два
describe('які відмови означають втрату прав на дошку', () => {
  it('лише NOT_BOARD_MANAGER і BOARD_NOT_FOUND', () => {
    expect(isLostBoardRights(MEMBER_ERROR.NOT_BOARD_MANAGER)).toBe(true);
    expect(isLostBoardRights('BOARD_NOT_FOUND')).toBe(true);
  });

  it('решта відмов панель не ховає — вони про ціль дії, а не про мене', () => {
    for (const code of [
      MEMBER_ERROR.USER_NOT_FOUND,
      MEMBER_ERROR.ALREADY_OWNER,
      MEMBER_ERROR.MEMBER_NOT_FOUND,
      MEMBER_ERROR.OWNER_IMMUTABLE,
      MEMBER_ERROR.CANNOT_MANAGE_MEMBER,
      'VALIDATION_ERROR',
    ]) {
      expect(isLostBoardRights(code), code).toBe(false);
    }
  });

  // без тексту під кодом errorText віддав би загальне «не вдалося запросити»,
  // і людина знову не знала б причини
  it('у кожного коду є свій текст', () => {
    for (const code of Object.values(MEMBER_ERROR)) {
      expect(uk.errors[code as keyof typeof uk.errors], code).toBeTruthy();
    }
  });
});
