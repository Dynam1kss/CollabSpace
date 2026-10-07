import type { NextFunction, Request, Response } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { getBoardAccess, requireBoardAccess } from './boards.service';

// Донедавна /uploads роздавалась через express.static без жодної перевірки:
// хто вгадав шлях, той і забрав картинку з чужої дошки. Імена випадкові, але
// це «захист здогадуванням», а не захист — посилання з адресного рядка
// розходиться далі само.
//
// Шляхи під /uploads бувають трьох видів:
//   /uploads/avatars/<userId>/<файл>   — аватар, видимий будь-кому в системі
//   /uploads/link-preview/<файл>       — картинка прев’ю, спільна на сервер
//   /uploads/<boardId>/<файл>          — картинка, вставлена в дошку
// Для перших двох досить бути залогіненим, для третього — бути учасником
// саме тієї дошки.
//
// Як сюди потрапляє авторизація: усе це вантажиться тегом <img> із НАШОГО ж
// походження, а для таких запитів браузер кладе куки сам. Виняток один —
// crossOrigin="anonymous": з ним запит іде БЕЗ кук, і картинка стала б 401.
// Тому в клієнті цей атрибут лишився тільки для чужих хостів (мініатюри
// youtube), а для наших шляхів його зняли
const SHARED = new Set(['avatars', 'link-preview']);

export function uploadsAccess(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    void checkBoard(req).then(next).catch(next);
  });
}

async function checkBoard(req: Request) {
  // req.url тут уже без префікса /uploads — express його зрізає на монтуванні
  const first = decodeURIComponent(req.url.split('?')[0].split('/').filter(Boolean)[0] ?? '');
  if (first === '' || SHARED.has(first)) return;
  // усе інше — тека дошки; доступ той самий, що й до самої дошки
  // кидає 404, якщо дошки немає або людина до неї не має стосунку
  requireBoardAccess(await getBoardAccess(first, req.userId as string));
}
