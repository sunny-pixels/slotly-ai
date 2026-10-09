import "dotenv/config";
import { execSync } from "node:child_process";

/**
 * Applies all migrations to the dedicated test database before the integration
 * suite runs. Requires TEST_DATABASE_URL (e.g. a Neon branch named "test").
 * The suite TRUNCATES every table, so never point this at real data.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || url.includes("USER:PASSWORD")) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests need a real PostgreSQL database with pgvector " +
        "(for example a Neon branch called 'test'). See README → Running tests.",
    );
  }
  if (url === process.env.DATABASE_URL || url === process.env.DIRECT_URL) {
    throw new Error("TEST_DATABASE_URL must not be the same database as DATABASE_URL/DIRECT_URL — the tests truncate all tables.");
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, PRISMA_MIGRATE_URL: url },
  });
}
