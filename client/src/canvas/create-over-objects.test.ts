import { describe, expect, it } from 'vitest';
import { objectsListen } from './editor-store';
import type { ToolId } from './editor-store';

// 06.10: під інструментом створення клік по наявному обʼєкту нічого не
// створював. Обʼєкт сам ставив cancelBubble на своєму mousedown
// (useSelectOnPointerDown), до Stage подія не доходила, а всі обробники
// створення починаються з `e.target !== stage → return`. Доводилось шукати
// порожнє місце. Лікується одним правилом: під інструментом створення шар
// обʼєктів подій не ловить, і цілиться завжди Stage
//
// самі обробники перевірками не накриті: вони тримають події konva, а konva в
// node-середовищі просить пакет canvas, якого в проєкті немає (див. журнал).
// Тут — правило, у якому й була помилка

const CREATION_TOOLS: ToolId[] = ['sticky', 'text', 'rect', 'ellipse', 'connector'];
const ALL_TOOLS: ToolId[] = ['select', ...CREATION_TOOLS];

describe('шар обʼєктів ловить події лише під інструментом вибору', () => {
  it('під вибором — ловить: виділення й тягання лишаються як були', () => {
    expect(objectsListen('select')).toBe(true);
  });

  it('під кожним інструментом створення — ні', () => {
    for (const tool of CREATION_TOOLS) expect(objectsListen(tool), tool).toBe(false);
  });

  // саме правило, а не перелік: якщо колись додадуть інструмент і забудуть його
  // тут, ця перевірка все одно скаже, що клікаються обʼєкти більш ніж під одним
  it('рівно один інструмент, під яким обʼєкти клікаються', () => {
    expect(ALL_TOOLS.filter(objectsListen)).toEqual(['select']);
  });

  // прапорці обʼєкта тут ні до чого: правило дивиться лише на інструмент, тому
  // ні замок, ні дозвіл на стільці, ні тип обʼєкта створенню поверх не мішають
  it('правило залежить тільки від інструмента, не від того, що під курсором', () => {
    expect(objectsListen('sticky')).toBe(objectsListen('connector'));
  });
});
