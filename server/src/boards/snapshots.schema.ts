import { z } from 'zod';

// дзеркало BoardObject зі shared: перевіряємо форму, а не сенс (координати
// можуть бути будь-які) — головне, щоб клієнт потім не впав на розборі
const base = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  zIndex: z.number(),
  createdBy: z.string(),
  createdAt: z.string(),
  // старі знімки поля не мають — там воно просто відсутнє
  seatsAllowed: z.boolean().optional(),
  locked: z.boolean().optional(),
};

const point = z.object({ x: z.number(), y: z.number() });

// вирівнювання тексту — теж необовʼязкове: до 06.10 все було вліво
const align = z.enum(['left', 'center', 'right']).optional();

export const boardObjectSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('sticky'),
    text: z.string(),
    fillColor: z.string(),
    textColor: z.string(),
    // стікери, збережені до появи канбану, поля не мають — при перезбереженні
    // стає null (у відповіді GET старий снепшот віддається як є, клієнт це знає)
    column: z.enum(['todo', 'in-progress', 'done']).nullable().default(null),
    // стікери до 06.10 розміру не мають — тоді він був прибитий у коді
    fontSize: z.number().optional(),
    align,
  }),
  z.object({
    ...base,
    type: z.literal('text'),
    text: z.string(),
    fontSize: z.number(),
    color: z.string(),
    autoWidth: z.boolean(),
    minHeight: z.number(),
    align,
  }),
  z.object({
    ...base,
    type: z.literal('shape'),
    shapeKind: z.enum(['rect', 'ellipse']),
    fillColor: z.string(),
    strokeColor: z.string(),
    strokeWidth: z.number(),
  }),
  z.object({
    ...base,
    type: z.literal('connector'),
    points: z.array(point).min(2),
    strokeColor: z.string(),
    strokeWidth: z.number(),
    arrowEnd: z.boolean(),
  }),
  z.object({
    ...base,
    type: z.literal('line'),
    from: point,
    to: point,
    strokeColor: z.string(),
    strokeWidth: z.number(),
    // без поля — суцільна; вістря найчастіше немає взагалі
    dash: z.enum(['solid', 'dashed', 'dotted']).optional(),
    arrowStart: z.boolean().optional(),
    arrowEnd: z.boolean().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('image'),
    url: z.string().min(1),
    // без них zod різав віддзеркалення при кожному збереженні
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
  }),
]);

export const saveSnapshotSchema = z.object({
  objects: z.array(boardObjectSchema),
  // стратегія 3: які клітинки клієнт тримає синхронізованими й переписує
  cells: z
    .array(z.string().regex(/^-?\d+:-?\d+$/))
    .max(10_000)
    .optional(),
});
