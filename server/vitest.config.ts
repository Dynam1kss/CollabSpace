import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

// vitest запускає тести у воркерах, звичайний process.env тут не долетить —
// тому явно передаємо env у test.env
const testEnv = config({ path: resolve(__dirname, '../.env.test') }).parsed ?? {};

export default defineConfig({
  test: {
    env: testEnv,
    fileParallelism: false,
  },
});
