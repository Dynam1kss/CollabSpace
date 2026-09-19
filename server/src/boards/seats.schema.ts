import { z } from 'zod';

// координати дошки, тому будь-які скінченні числа; finite — щоб NaN та
// нескінченність не лягли в базу й не зламали потім розрахунок відстані
export const saveSeatSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
