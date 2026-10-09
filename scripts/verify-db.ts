/**
 * pnpm db:verify — asserts that the database-level integrity guarantees exist.
 * Run after every migration; CI should fail if any check is missing.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/server/db";

export const REQUIRED_CHECKS = [
  {
    name: "unique_active_booking_per_slot (partial unique index — the double-booking guard)",
    sql: `SELECT 1 FROM pg_indexes WHERE indexname = 'unique_active_booking_per_slot'
          AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(slot_id)%' AND indexdef ILIKE '%PENDING%' AND indexdef ILIKE '%CONFIRMED%'`,
  },
  { name: "slots_no_overlap_per_service (exclusion constraint)", sql: `SELECT 1 FROM pg_constraint WHERE conname = 'slots_no_overlap_per_service' AND contype = 'x'` },
  { name: "slots_valid_interval (CHECK end_at > start_at)", sql: `SELECT 1 FROM pg_constraint WHERE conname = 'slots_valid_interval' AND contype = 'c'` },
  { name: "bookings_cancelled_has_timestamp (CHECK)", sql: `SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cancelled_has_timestamp'` },
  { name: "slots (service_id, start_at) unique", sql: `SELECT 1 FROM pg_indexes WHERE tablename = 'slots' AND indexdef ILIKE '%UNIQUE%(service_id, start_at)%'` },
  { name: "pgvector extension", sql: `SELECT 1 FROM pg_extension WHERE extname = 'vector'` },
  { name: "knowledge_chunks_embedding_hnsw (vector index)", sql: `SELECT 1 FROM pg_indexes WHERE indexname = 'knowledge_chunks_embedding_hnsw'` },
] as const;

export async function verifyDatabase(connectionString?: string) {
  const db = createPrismaClient(connectionString ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL);
  try {
    const results: { name: string; ok: boolean }[] = [];
    for (const check of REQUIRED_CHECKS) {
      const rows = await db.$queryRawUnsafe<unknown[]>(check.sql);
      results.push({ name: check.name, ok: rows.length > 0 });
    }
    return results;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/verify-db.ts")) {
  verifyDatabase()
    .then((results) => {
      for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}`);
      if (results.some((r) => !r.ok)) {
        console.error("\nDatabase integrity checks FAILED. Run `pnpm db:migrate` and review recent migrations.");
        process.exitCode = 1;
      } else {
        console.log("\nAll database integrity checks passed.");
      }
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
