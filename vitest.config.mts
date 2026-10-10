import "dotenv/config";
import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  // `server-only` throws outside React Server Components; tests run in plain Node.
  "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          env: { EMBEDDING_PROVIDER: "fake", LLM_PROVIDER: "none", BUSINESS_TIMEZONE: "Asia/Kolkata" },
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // Integration tests share one real PostgreSQL database and truncate it — run files one at a time.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 180_000,
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/support/integration-setup.ts"],
          env: {
            // The app's Prisma client reads DATABASE_URL — point it at the dedicated test database.
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            BUSINESS_TIMEZONE: "Asia/Kolkata",
            CANCELLATION_CUTOFF_HOURS: "24",
            BOOKING_MIN_LEAD_MINUTES: "60",
            EMBEDDING_PROVIDER: "local",
            LLM_PROVIDER: "none",
            DATABASE_POOL_MAX: "5",
          },
        },
      },
    ],
  },
});
