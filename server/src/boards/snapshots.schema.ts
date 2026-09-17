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
};

const point = z.object({ x: z.number(), y: z.number() });

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
  }),
  z.object({
    ...base,
    type: z.literal('text'),
    text: z.string(),
    fontSize: z.number(),
    color: z.string(),
    autoWidth: z.boolean(),
    minHeight: z.number(),
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
    type: z.literal('image'),
    url: z.string().min(1),
  }),
]);

export const saveSnapshotSchema = z.object({
  objects: z.array(boardObjectSchema),
});
