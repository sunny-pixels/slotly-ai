-- Hand-written migration: integrity rules Prisma's schema language cannot express.
-- Verified at runtime by `pnpm db:verify` and tests/integration/db-constraints.test.ts.
--
-- NOTE: the core double-booking guard (`unique_active_booking_per_slot`, a partial
-- unique index on bookings(slot_id) WHERE status IN ('PENDING','CONFIRMED')) is
-- declared in schema.prisma and created by the previous migration.

-- ── Slots ────────────────────────────────────────────────────────────────────
-- A slot must be a valid, non-empty interval.
ALTER TABLE "slots"
  ADD CONSTRAINT "slots_valid_interval" CHECK ("end_at" > "start_at");

-- Slots of the same service may never overlap (exclusive resource model).
-- Half-open ranges '[)' let back-to-back slots (10:00-11:00, 11:00-12:00) coexist.
ALTER TABLE "slots"
  ADD CONSTRAINT "slots_no_overlap_per_service"
  EXCLUDE USING gist ("service_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&);

-- ── Services ─────────────────────────────────────────────────────────────────
ALTER TABLE "services"
  ADD CONSTRAINT "services_price_non_negative" CHECK ("price_cents" >= 0),
  ADD CONSTRAINT "services_duration_range" CHECK ("duration_minutes" BETWEEN 5 AND 480),
  ADD CONSTRAINT "services_currency_upper" CHECK ("currency" ~ '^[A-Z]{3}$');

-- ── Availability rules ───────────────────────────────────────────────────────
ALTER TABLE "availability_rules"
  ADD CONSTRAINT "availability_rules_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6),
  ADD CONSTRAINT "availability_rules_time_format"
    CHECK ("open_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "close_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "availability_rules_open_before_close" CHECK ("open_time" < "close_time"),
  ADD CONSTRAINT "availability_rules_interval_range" CHECK ("slot_interval_minutes" BETWEEN 5 AND 480),
  ADD CONSTRAINT "availability_rules_effective_range"
    CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from");

-- ── Bookings ─────────────────────────────────────────────────────────────────
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_price_non_negative" CHECK ("price_cents" >= 0),
  -- A cancelled booking always records when it was cancelled.
  ADD CONSTRAINT "bookings_cancelled_has_timestamp"
    CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL);

-- ── Knowledge base vector index ──────────────────────────────────────────────
-- Approximate nearest-neighbour search on cosine distance (pgvector HNSW).
CREATE INDEX "knowledge_chunks_embedding_hnsw"
  ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
