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
  // чи можна ставити на цей обʼєкт голосові стільці. Зазвичай стілець
  // обходить обʼєкти стороною, але для намальованого дивана чи столу це
  // якраз заважає. Ставить власник або адміністратор; старі снепшоти поля
  // не мають — там це просто false
  seatsAllowed?: boolean;
  // захист від випадкового зсуву: замкнений обʼєкт не тягається, не
  // міняє розміру й не видаляється, але виділяти його можна — інакше
  // нізвідки взяти саму кнопку «відімкнути». Ставить будь-хто, крім
  // глядача; старі снепшоти поля не мають — там це false
  locked?: boolean;
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
  // необовʼязковий, як seatsAllowed: до 06.10 розмір був прибитий у коді, і
  // старі стікери поля не мають — у них читається STICKY_FONT_SIZE, тобто
  // рівно те, чим вони й малювались
  fontSize?: number;
}

// розмір тексту стікера, яким він був до появи самого поля. Міняти не можна:
// на це число спираються всі дошки, збережені раніше
export const STICKY_FONT_SIZE = 16;

export function stickyFontSize(object: Pick<StickyObject, 'fontSize'>) {
  return object.fontSize ?? STICKY_FONT_SIZE;
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
  // віддзеркалення вмісту. Необовʼязкові, як seatsAllowed: старі знімки їх
  // просто не мають, і це читається як false. На x/y/width/height не
  // впливають — це суто про те, як намальовано растр
  flipX?: boolean;
  flipY?: boolean;
}

export type BoardObject = StickyObject | TextObject | ShapeObject | ConnectorObject | ImageObject;
export type BoardObjectType = BoardObject['type'];
