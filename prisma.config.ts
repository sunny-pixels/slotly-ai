import "dotenv/config";
import { defineConfig } from "prisma/config";

// The Prisma CLI (migrate, seed) must use Neon's *direct* (unpooled) connection.
// The running app uses the pooled DATABASE_URL through the pg driver adapter (src/server/db.ts).
// PRISMA_MIGRATE_URL lets scripts (e.g. the integration test setup) target another database.
const url = process.env.PRISMA_MIGRATE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: url ?? "",
  },
});
