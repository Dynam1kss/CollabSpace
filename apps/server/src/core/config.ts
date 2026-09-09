import { z } from "zod";

// Валідуємо env одразу при старті — щоб сервер падав з чіткою помилкою,
// а не десь посеред запиту через відсутній секрет.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  ACCESS_TOKEN_TTL: z.string().min(1),
  REFRESH_TOKEN_TTL: z.string().min(1),
  WS_TICKET_TTL: z.string().min(1),
});

export const config = envSchema.parse(process.env);
