// числові межі редактора окремо від object-defaults: той тягне за собою
// konva (через геометрію конектора й розкладку тексту), а їх читає й
// математика трансформації, яку хочеться тестувати без полотна
export const STROKE_WIDTH_MIN = 1;
export const STROKE_WIDTH_MAX = 20;
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 200;
// менший за це обʼєкт не робимо — ні протягуванням, ні ручкою трансформера
export const MIN_SIZE = 8;
