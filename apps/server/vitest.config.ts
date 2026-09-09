import { defineConfig } from "vitest/config";

// Тестові секрети — не з .env: юніт-тести не повинні залежати від
// наявності реального локального .env (і тим паче від реальної БД).
export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      ACCESS_TOKEN_TTL: "15m",
      REFRESH_TOKEN_TTL: "7d",
      WS_TICKET_TTL: "30s",
    },
  },
});
