import { MAX_SCALE } from './coordinates';

// числові межі редактора окремо від object-defaults: той тягне за собою
// konva (через геометрію конектора й розкладку тексту), а їх читає й
// математика трансформації, яку хочеться тестувати без полотна
export const STROKE_WIDTH_MIN = 1;
export const STROKE_WIDTH_MAX = 20;
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 200;
// щоб сторона не виродилась у нуль: konva давиться нульовою стороною й
// глушить увесь кадр. Це НЕ мінімум обʼєкта — тут про вміст, який сам
// вирішує свою висоту (текстовий блок під свій шрифт)
export const MIN_BOX_SIDE = 8;

// мінімальний обʼєкт має лишатись видимим навіть коли на нього наблизились
// впритул. Домовленість: на максимальному зумі він займає приблизно пʼяту
// частину висоти вікна. Звідси число й рахується, а не береться на око —
// інакше на 400% мінімальний обʼєкт виглядав крихтою в кілька пікселів
const MIN_SIZE_SCREEN_SHARE = 5;
// коли вікна ще нема (тести) — типовий ноутбучний екран
const REFERENCE_VIEWPORT_HEIGHT = 850;
const viewportHeight =
  typeof window !== 'undefined' && window.innerHeight > 0
    ? window.innerHeight
    : REFERENCE_VIEWPORT_HEIGHT;

export const MIN_SIZE = Math.round(viewportHeight / MIN_SIZE_SCREEN_SHARE / MAX_SCALE);
