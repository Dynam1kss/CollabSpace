import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env в корені, не в server/, тому шлях явно
config({ path: resolve(__dirname, '../../.env') });

const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET) {
  if (isProduction) {
    throw new Error('JWT_SECRET не задано — обовʼязковий у продакшені');
  }
  console.warn('JWT_SECRET не задано в .env, використовується тестовий секрет — тільки для розробки');
}

export const env = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-not-for-production',
  isProduction,
};
