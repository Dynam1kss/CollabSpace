import type { BoardObject } from 'shared';

// точка, навколо якої konva крутить обʼєкт, — відносно його лівого верхнього
// кута. Еліпс стоїть від центру (offset на пів розміру в ShapeNode), решта від x/y.
// Усе, що крутиться разом з обʼєктом (чужі рамки, замки, бейджі), мусить мати
// той самий центр повороту, інакше на куті воно відʼїжджає вбік
export function pivotOffset(object: BoardObject) {
  if (object.type === 'shape' && object.shapeKind === 'ellipse') {
    return { x: object.width / 2, y: object.height / 2 };
  }
  return { x: 0, y: 0 };
}
