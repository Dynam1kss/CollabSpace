import type { BoardObject } from 'shared';
import type { Viewport } from './coordinates';
import { clampScale } from './coordinates';

// текст носять лише стікер і текстовий блок — решті шукати нема в чому
export interface SearchHit {
  id: string;
  type: 'sticky' | 'text';
  snippet: string;
}

// скільки символів лишаємо в рядку списку: довгий стікер інакше розсуває
// попап на весь екран
const SNIPPET_MAX = 42;

function snippetOf(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_MAX ? flat.slice(0, SNIPPET_MAX) + '…' : flat;
}

// підрядок без урахування регістру. Порядок — як на дошці знизу вгору за
// z, щоб список не стрибав при кожному перемальовуванні
export function searchObjects(objects: BoardObject[], query: string): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return objects
    .filter((o): o is Extract<BoardObject, { type: 'sticky' | 'text' }> => o.type === 'sticky' || o.type === 'text')
    .filter((o) => o.text.toLowerCase().includes(needle))
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((o) => ({ id: o.id, type: o.type, snippet: snippetOf(o.text) }));
}

// вʼїхати в один обʼєкт: масштаб не чіпаємо (людина сама вибрала, як близько
// дивиться), лише зсуваємо так, щоб центр обʼєкта став центром екрана.
// Це не fitToObjects — той підганяє масштаб під вміст, а тут стрибок по
// дошці, і раптова зміна масштабу дезорієнтувала б
export function centerOnObject(
  object: BoardObject,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): Viewport {
  const scale = clampScale(viewport.scale);
  return {
    scale,
    x: canvasWidth / 2 - (object.x + object.width / 2) * scale,
    y: canvasHeight / 2 - (object.y + object.height / 2) * scale,
  };
}
