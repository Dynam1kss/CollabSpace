export interface BoardObjectBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  createdBy: string;
  createdAt: string;
}

export type StickyColumn = 'todo' | 'in-progress' | 'done';

// column — колонка канбан-подання; null — стікер поза дошкою задач, на
// полотні він нічим не відрізняється. старі снепшоти поля не мають взагалі
export interface StickyObject extends BoardObjectBase {
  type: 'sticky';
  text: string;
  fillColor: string;
  textColor: string;
  column: StickyColumn | null;
}

// autoWidth — ширина ще ніким не задана: блок росте вшир за текстом без
// переносу; після першого тягання бокового ребра стає false і width — межа,
// по якій переносяться слова. height завжди похідна від вмісту (текст не
// обрізається ніколи), minHeight — нижня межа, яку ставить нижнє ребро
export interface TextObject extends BoardObjectBase {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  autoWidth: boolean;
  minHeight: number;
}

export type ShapeKind = 'rect' | 'ellipse';

export interface ShapeObject extends BoardObjectBase {
  type: 'shape';
  shapeKind: ShapeKind;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface BoardPoint {
  x: number;
  y: number;
}

// points — впорядковані основні точки лінії (мінімум 2), крива через них
// малюється сплайном. x/y/width/height — bounding box по всіх точках (для
// виділення й уніфікованого hit-теста поруч з іншими типами). Тримати їх
// узгодженими — відповідальність коду, що змінює обʼєкт
export interface ConnectorObject extends BoardObjectBase {
  type: 'connector';
  points: BoardPoint[];
  strokeColor: string;
  strokeWidth: number;
  arrowEnd: boolean;
}

// url — відносний шлях /uploads/..., сам файл лежить на диску сервера
export interface ImageObject extends BoardObjectBase {
  type: 'image';
  url: string;
}

export type BoardObject = StickyObject | TextObject | ShapeObject | ConnectorObject | ImageObject;
export type BoardObjectType = BoardObject['type'];
