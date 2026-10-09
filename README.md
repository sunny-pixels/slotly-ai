# Slotly AI

**Book smarter. Never double-book.**

Slotly AI is a booking and reservation platform for a fictional studio offering consultations, coaching and wellness appointments. It has three parts:

- **Live availability and booking**, with a PostgreSQL constraint that makes double booking impossible, even under concurrent requests.
- **Customer and administrator workspaces** for managing services, opening hours, slots, bookings and the knowledge base.
- **A grounded booking assistant** that combines Retrieval-Augmented Generation (RAG) over the studio's documents with read-only tools that query the live booking database. It never books or cancels anything without the user's explicit confirmation.

> All services, prices, people, policies and addresses in this repository are **demonstration data**.

---

## Contents
1. [Features](#features)
2. [Architecture](#architecture)
3. [Technology stack](#technology-stack)
4. [Local setup](#local-setup)
5. [Environment variables](#environment-variables)
6. [Database, migrations and seed data](#database-migrations-and-seed-data)
7. [Authentication and demo accounts](#authentication-and-demo-accounts)
8. [Double-booking prevention](#double-booking-prevention)
9. [RAG: ingestion, retrieval and grounded answers](#rag-ingestion-retrieval-and-grounded-answers)
10. [AI providers (free tiers)](#ai-providers-free-tiers)
11. [The assistant and its tools](#the-assistant-and-its-tools)
12. [API reference](#api-reference)
13. [Testing](#testing)
14. [Deployment](#deployment)
15. [Architecture decisions](#architecture-decisions)
16. [Known limitations](#known-limitations)

---

## Features

**Customers**
- Browse services with search plus category, price and duration filters. Each service shows the next bookable time, read live from the database.
- Book through a date strip and calendar plus a slot grid. Booked and unavailable times are visible but not selectable. Times are shown in studio time, with the visitor's own time zone shown when it differs.
- A confirmation step comes before anything is booked. A success screen with a booking reference (e.g. `SLT-7KQ2MD`) appears only after the transaction commits.
- If someone else takes the slot first, you get a clear conflict message (HTTP 409) and availability refreshes. A conflicting booking is never shown as confirmed.
- **My bookings**: upcoming, past and cancelled tabs, search, pagination, and a detail page with the cancellation policy. Self-service cancellation is allowed up to 24 hours before the start time.
- **Assistant** (`/assistant`): policy questions answered with citations, service recommendations, live open times, a booking proposal step, and cancellation with confirmation.

**Administrators** (`/admin`)
- **Overview**: database-derived counts (upcoming bookings, today's agenda, open slots for the next 7 days, recent activity) and pending actions. There are no invented charts.
- **Services**: create and edit services, change price and duration, and activate or deactivate them. Services are never deleted. Duration changes are refused while upcoming bookings exist, and price changes don't affect existing bookings because each booking stores a price snapshot.
- **Availability**: weekly opening-hour rules (overlap-checked), idempotent slot generation, and a week grid for blocking and re-opening slots. A slot with an active booking cannot be blocked.
- **Bookings**: filter by status, service, date range or customer; cancel any booking; mark past appointments completed.
- **Knowledge base**: upload `.md`/`.txt` files or paste text. You can see ingestion status, version, chunk count and errors, re-process documents, retire or re-activate them, delete them, and inspect exactly which chunks the assistant can retrieve.

---

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI["Next.js pages<br/>(server components + small client islands)"]
  end

  subgraph Next["Next.js 16 server (Node runtime)"]
    RH["Route handlers /api/*<br/>Zod validation · authz · error mapping"]
    SA["Server actions<br/>(demo account switcher)"]
    subgraph Domain["Domain services (src/server/services)"]
      CAT[catalog]
      AV[availability]
      SCH[scheduling]
      BK["bookings<br/>(transactions)"]
    end
    subgraph AI["Assistant (src/server/assistant + rag)"]
      ORC["orchestrator<br/>intent routing"]
      TOOLS["read-only tools"]
      RAG["retrieve → generate<br/>(grounded, cited)"]
      EMB["embeddings<br/>local bge-small / Gemini"]
    end
  end

  subgraph Neon["PostgreSQL (Neon)"]
    TABLES[("users · services · availability_rules<br/>slots · bookings")]
    IDX{{"unique_active_booking_per_slot<br/>partial unique index"}}
    VEC[("knowledge_documents<br/>knowledge_chunks vector(384) + HNSW")]
  end

  LLM["Groq / Gemini<br/>(optional, free tier)"]

  UI -->|fetch / forms| RH
  UI --> SA
  RH --> Domain
  RH --> ORC
  ORC --> TOOLS
  TOOLS --> Domain
  TOOLS --> RAG
  RAG --> EMB
  RAG -->|cosine search| VEC
  RAG -.->|optional| LLM
  Domain --> TABLES
  BK --> IDX
```

**Two separate paths.** The assistant uses two different mechanisms, and they never stand in for each other.

| Concern | Source of truth | Mechanism |
|---|---|---|
| Policies, opening hours, service descriptions, FAQ | Knowledge documents | RAG: embeddings + pgvector similarity search + grounded generation |
| Live availability, prices charged, booking status, a customer's own bookings, conflict prevention | PostgreSQL tables | Validated domain services and SQL transactions |

Vector search is never used to answer "is 10:00 free?". Customer bookings are never embedded, so private data cannot leak through retrieval.

**Code layout**

```
prisma/                 schema.prisma, migrations/, seed.ts
knowledge/              demo knowledge base (markdown with front matter)
evals/rag-eval.json     retrieval evaluation set
scripts/                verify-db, ingest-knowledge, eval-rag
src/app/(app)/          pages: /, /services/[id]/book, /bookings, /assistant, /admin/*
src/app/api/            route handlers (REST API)
src/server/             server-only code: db, auth, authz, http, errors, rate limiting
  services/             catalog, availability, scheduling, bookings, dashboard
  rag/                  chunker, embeddings, ingest, retrieve, llm, prompts, generate
  assistant/            router (intent + slot filling), tools, orchestrator
src/components/         ui primitives, shell, booking, services, assistant, admin
src/lib/                shared pure code: config, time, money, validators, booking rules
tests/                  unit/, integration/, e2e/
```

---

## Technology stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict) |
| UI | Tailwind CSS v4 with design tokens, Radix primitives (`radix-ui`), lucide-react, sonner toasts, react-day-picker |
| Fonts | Manrope (headings) and Inter (body) via `next/font` |
| Validation | Zod 4 |
| Database | PostgreSQL on **Neon**, with `pgvector` and `btree_gist` |
| ORM | Prisma 7 with the `@prisma/adapter-pg` driver adapter; `partialIndexes` and `postgresqlExtensions` preview features |
| Auth | Auth.js v5 (`next-auth`), JWT session cookie, demo-account provider |
| Embeddings | `@huggingface/transformers` running `Xenova/bge-small-en-v1.5` locally (free, 384-dim), or Gemini `gemini-embedding-001` |
| Reranking | Local cross-encoder `Xenova/ms-marco-MiniLM-L-6-v2` (free) |
| LLM (optional) | Groq (`llama-3.3-70b-versatile`) or Google Gemini (`gemini-2.5-flash`), both free tiers, called with plain `fetch` |
| Tests | Vitest (unit + integration against real Postgres), Playwright (e2e) |

---

## Local setup

**Prerequisites:** Node.js ≥ 20.9 (developed on 22), pnpm 10, and a Neon project (or any PostgreSQL ≥ 15 with `pgvector`).

```bash
pnpm install                 # also runs `prisma generate`
cp .env.example .env         # then fill in the database URLs (see below)
pnpm db:setup                # migrate → seed (incl. knowledge base) → verify constraints
pnpm dev                     # http://localhost:3000
```

The first seed downloads the local embedding model (~35 MB) into `.cache/models`. Later runs reuse it.

### Neon setup
1. Create a Neon project. `pgvector` and `btree_gist` are available on Neon, and the first migration runs `CREATE EXTENSION` for both.
2. On the default branch (called `production` in newer Neon projects, `main` in older ones), copy the **pooled** connection string (host contains `-pooler`) into `DATABASE_URL`. The running app uses this.
3. Copy the **direct** connection string into `DIRECT_URL`. The Prisma CLI uses this for migrations and seeding.
4. For tests, create a Neon **branch** (e.g. `test`) and put its connection string in `TEST_DATABASE_URL`. The integration suite **truncates every table** in that database.

### Local PostgreSQL alternative
```bash
docker compose up -d          # pgvector/pgvector:pg17 on localhost:5433
# DATABASE_URL / DIRECT_URL = postgresql://slotly:slotly@localhost:5433/slotly
# TEST_DATABASE_URL         = postgresql://slotly:slotly@localhost:5433/slotly_test
```

---

## Environment variables

All variables are server-side only. None are exposed to the browser.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✓ | – | Pooled Neon URL used by the app |
| `DIRECT_URL` | ✓ | – | Direct Neon URL used by migrations and seeding |
| `TEST_DATABASE_URL` | tests | – | Separate database for integration tests (gets truncated) |
| `AUTH_SECRET` | ✓ | – | Signs session cookies (`npx auth secret`) |
| `AUTH_TRUST_HOST` | | `true` | Trust the host header (needed behind proxies) |
| `DEMO_ACCOUNTS_ENABLED` | | `true` | Enables the "Continue as…" switcher. **Set to `false` for real data.** |
| `SEED_ADMIN_EMAIL` / `SEED_CUSTOMER_EMAIL` / `SEED_SECOND_CUSTOMER_EMAIL` | | `admin@`/`maya@`/`sam@slotly.dev` | Seeded demo identities |
| `BUSINESS_TIMEZONE` | | `Europe/London` | Studio time zone for opening hours and display |
| `CANCELLATION_CUTOFF_HOURS` | | `24` | Customer self-cancellation window |
| `BOOKING_MIN_LEAD_MINUTES` | | `60` | Online booking closes this long before the start |
| `EMBEDDING_PROVIDER` | | `local` | `local` (free, in-process) or `gemini` |
| `EMBEDDING_MODEL` | | `Xenova/bge-small-en-v1.5` | Local model (must output 384 dimensions) |
| `LLM_PROVIDER` | | `none` | `none`, `groq` or `gemini` |
| `GROQ_API_KEY`, `GROQ_MODEL` | | –, `llama-3.3-70b-versatile` | Groq settings |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | | –, `gemini-2.5-flash` | Gemini settings (also used for `EMBEDDING_PROVIDER=gemini`) |
| `LLM_TIMEOUT_MS` | | `20000` | Timeout for provider calls |
| `RAG_TOP_K` | | `5` | Nearest chunks retrieved |
| `RAG_CHUNK_SIZE` / `RAG_CHUNK_OVERLAP` | | `800` / `120` | Chunking (characters) |
| `RAG_MAX_DISTANCE` | | `0.6` | Loose cosine-distance pre-filter for candidates |
| `RAG_CANDIDATES` | | `12` | Nearest chunks passed to the reranker |
| `RAG_RERANK` / `RAG_RERANK_MODEL` | | `true` / `Xenova/ms-marco-MiniLM-L-6-v2` | Cross-encoder reranking (local, free) |
| `RAG_MIN_RERANK_SCORE` | | `-10.6` | Below this logit a passage does not cover the question ("not in documentation") |
| `RAG_CONFIDENT_RERANK_SCORE` | | `0` | At or above this logit the top passage is a direct match |
| `DATABASE_POOL_MAX` | | `10` | pg pool size per process |

---

## Database, migrations and seed data

```bash
pnpm db:migrate        # prisma migrate deploy (applies prisma/migrations/*)
pnpm db:seed           # idempotent demo data + knowledge-base ingestion
pnpm db:verify         # asserts the integrity constraints exist (exit 1 if not)
pnpm db:setup          # all three, in order
pnpm db:migrate:dev    # create a new migration during development
```

**Schema** (`prisma/schema.prisma`, snake_case tables)

| Table | Highlights |
|---|---|
| `users` | `role` is `CUSTOMER` or `ADMIN` |
| `services` | price in integer minor units (`price_cents`), `is_active`, unique `slug` |
| `availability_rules` | weekday, `HH:mm` open/close, slot interval, time zone, optional effective dates |
| `slots` | `start_at`/`end_at` as `timestamptz`, `AVAILABLE` or `BLOCKED`; unique `(service_id, start_at)` |
| `bookings` | `public_reference`, status `PENDING` / `CONFIRMED` / `CANCELLED` / `COMPLETED`, price snapshot, `cancelled_at`, `cancelled_by_id` |
| `knowledge_documents` | stable `slug`, `content_hash`, `version`, ingestion `status`, `error`, `chunk_count`, `is_active`, `superseded_by`, `embedding_model` |
| `knowledge_chunks` | `content`, `heading_path`, `embedding vector(384)` with an HNSW cosine index |
| `assistant_logs` | intent, mode, provider, retrieval and generation ms, source chunk ids, token usage, error. No message text, no PII. |

**Migrations**
- `20261009120000_init` creates the extensions, tables, enums, foreign keys, indexes and the `unique_active_booking_per_slot` partial unique index.
- `20261009120100_integrity_constraints_and_vector_index` is hand-written SQL for rules Prisma cannot express:
  - `CHECK (end_at > start_at)`;
  - a `btree_gist` exclusion constraint forbidding overlapping slots per service;
  - price, duration, currency, weekday and time-format checks;
  - "cancelled bookings must have `cancelled_at`";
  - the HNSW vector index.

**Seed data** (`prisma/seed.ts`) is idempotent: rerunning it never duplicates rows. It creates:
- 3 demo users;
- 6 services with weekly opening hours;
- **14 days of slots** generated in the business time zone from the same generator the admin UI uses;
- demo bookings, each with a fixed reference:
  - `SLT-DEMO01`, `SLT-DEMO02` — confirmed, Maya;
  - `SLT-DEMO03` — cancelled, so its slot is open again;
  - `SLT-DEMO04` — Sam's booking, so Maya sees that time as booked;
  - `SLT-DEMO05` — a completed past session;
- the knowledge base (6 documents, including a superseded 2024 policy that is kept inactive).

Re-run `pnpm db:seed` on later days to extend slots so 14 days stay published.

---

## Authentication and demo accounts

Authentication uses **Auth.js v5** with signed, HTTP-only JWT session cookies. As requested for this demo, there are **no sign-in or sign-up pages**. Identity comes from a **"Continue as…" demo-account switcher** in the sidebar, and from the same picker shown inline wherever an action needs a user:

| Account | Role | What it shows |
|---|---|---|
| **Maya Chen** (`maya@slotly.dev`) | Customer | Upcoming, past and cancelled bookings |
| **Sam Okafor** (`sam@slotly.dev`) | Customer | A second customer, for ownership checks |
| **Ava Patel** (`admin@slotly.dev`) | Admin | Full studio admin |

How it stays safe:
- The browser only sends an **account key** (`maya` / `sam` / `admin`) to a server action. The server maps the key to a seeded user, and there is no way to submit an arbitrary email, id or role.
- The session identifies the user, and **every protected route handler re-reads the user and their role from the database** (`src/server/authz.ts`). A demoted administrator loses access on the next request. Hiding admin navigation is cosmetic only, because every `/api/admin/*` handler calls `requireAdmin()`.
- Customers reach only their own bookings. Ownership is part of each query, and another customer's booking is reported as **404**, so its existence isn't revealed. Request bodies never carry a customer id.
- There is no public registration, so nothing can grant itself administrator rights.

> **Production note:** a switcher that lets anyone act as an administrator is only appropriate for a demo. Set `DEMO_ACCOUNTS_ENABLED=false` and add a real Auth.js provider (email magic link, OAuth, or passwords) before handling real customers. The authorization layer does not need to change.

---

## Double-booking prevention

The guarantee is enforced **by PostgreSQL**:

```sql
CREATE UNIQUE INDEX "unique_active_booking_per_slot"
  ON "bookings" ("slot_id")
  WHERE (status IN ('PENDING', 'CONFIRMED'));
```

- At most one *active* booking can reference a slot. Cancelled and completed bookings fall outside the index, so a cancelled slot can be booked again immediately while its history is kept.
- The index is declared in `schema.prisma` through Prisma's `partialIndexes` preview feature (`@@unique([slotId], where: raw(...))`). Prisma therefore knows about it and **future `migrate dev` runs will not drop it**. `pnpm db:verify` and an integration test also assert that it exists.

**The booking transaction** (`src/server/services/bookings.ts`):
1. The route authenticates the caller (`requireUser`). The customer id comes from the session only.
2. Inside `prisma.$transaction`, the slot and service are read with `SELECT … FOR SHARE`. This rejects inactive services, blocked slots, past slots and slots inside the booking lead time with 422. Concurrent bookings don't block each other, but an administrator blocking the slot (`FOR UPDATE`) is serialised against them.
3. A friendly pre-check looks for an existing active booking.
4. The booking is inserted with the service's current price as a snapshot.
5. If a concurrent transaction committed first, the INSERT fails with a unique violation (`23505`, or Prisma `P2002`). This maps to **`409 SLOT_TAKEN`**.
6. Success (`201`) is returned only after the transaction commits.

**Why the database constraint is needed when the UI only shows free slots.** The UI and the pre-check are both *read-then-write*. Two people can load the page, both see 10:00 free, and both click within the same few milliseconds. Each request's availability check passes because neither has inserted yet. Disabled buttons, application `if` statements, in-memory locks and process-local mutexes cannot see requests running on another server instance or serverless function. Only the database observes every write, so the partial unique index makes the second commit fail, however the requests were routed. The concurrency tests demonstrate this, including a test that bypasses every application check.

Related rules:
- **Overlapping slots** for a service are rejected by an exclusion constraint. Slot generation uses `ON CONFLICT DO NOTHING`, so repeated generation is safe.
- **Capacity model.** Each service is an exclusive resource with its own practitioner, so a slot holds exactly one booking. Group classes would need an explicit capacity column and a count-based constraint or trigger; that isn't implemented.
- **No PENDING holds.** Bookings are created as `CONFIRMED` in one step, so there is nothing to expire. `PENDING` is kept in the state model and in the index so a payment-hold flow could be added. That flow would need an expiry job (e.g. a cron that cancels `PENDING` rows older than N minutes).

**Cancellation** is an authorised state transition:
1. The booking row is locked (`FOR UPDATE`).
2. Ownership is checked; customers get 404 for other people's bookings.
3. The 24-hour policy window is checked for customers. Administrators can cancel at any time.
4. The row is updated with `WHERE id = … AND customer_id = … AND status IN (active)`.

Repeating a cancellation returns `200 { alreadyCancelled: true }`.

---

## RAG: ingestion, retrieval and grounded answers

**Knowledge documents** live in `knowledge/*.md` and use front matter for `title`, `category`, `effective`, `active` and `supersededBy`. They cover:
- the service catalogue;
- booking rules;
- the cancellation and rescheduling policy (2026);
- the **superseded** 2024 cancellation policy (inactive);
- opening hours and location;
- an FAQ.

Administrators can add more from `/admin/knowledge-base`.

**Ingestion pipeline** (`src/server/rag/ingest.ts`):
1. **Validate.** Uploads must be `.md`, `.markdown` or `.txt`, at most 512 KB, and strictly UTF-8. Binary content is rejected, and content is never executed or rendered as HTML.
2. **Normalise.** Line endings, control characters and blank-line runs are cleaned up; paragraphs, lists and headings are kept.
3. **Hash.** If the slug, SHA-256 and embedding model are unchanged, ingestion is **skipped**, so seeding and restarts never re-embed or duplicate anything.
4. **Chunk** (`chunker.ts`). The text is split at Markdown headings, and each chunk carries its heading path ("Cancellation policy › Late cancellations"). Sections are packed by paragraph, then sentence, with configurable `RAG_CHUNK_SIZE` and `RAG_CHUNK_OVERLAP`.
5. **Embed** in batches with the configured provider.
6. **Store.** The document's chunks are replaced in one transaction, along with `vector(384)` embeddings, the version (bumped when content changes), status, chunk count and model id.
7. **Record failures.** The status is set to `FAILED` with an error message, and the document is excluded from search.

`pnpm kb:ingest` re-syncs the `knowledge/` folder. `pnpm kb:ingest --force` re-embeds everything, for example after changing the chunking settings.

**Retrieval** (`retrieve.ts`):
1. The query is normalised and embedded. BGE models get their query instruction prefix.
2. pgvector cosine search (`ORDER BY embedding <=> $q`) returns the `RAG_CANDIDATES` nearest chunks. It runs only over documents that are **active**, **READY** and **embedded by the current model**, with an optional category filter.
3. A **cross-encoder reranker** (`rerank.ts`) reads the question and each passage together and returns a relevance logit, which reorders the candidates. The top `RAG_TOP_K` are kept.
4. **Confidence gate**, based on the top reranker score:

   | Score | Confidence | Behaviour |
   |---|---|---|
   | ≥ `RAG_CONFIDENT_RERANK_SCORE` | **high** | Direct match. Answered and cited. |
   | between the two thresholds | **low** | Related passage only. Shown as *"I couldn't find a direct answer… the closest passage is…"*; with an LLM, the model is told the passages may not answer the question. |
   | < `RAG_MIN_RERANK_SCORE` | **none** | *"I couldn't find that in Slotly's documentation"*, with no citations. |

   If the reranker can't load, retrieval falls back to vector order and marks every result low-confidence. It never fails closed on the booking system.
5. Each hit carries its real cosine distance and reranker score, plus document title, slug, version and heading path. The UI shows titles and excerpts, never invented confidence percentages.

*Why a reranker?* The first evaluation run showed off-topic questions at cosine distance 0.40–0.47, overlapping legitimate paraphrases at up to 0.46, so no single distance threshold separated them. Cross-encoder scores separate direct matches (≥ ~2) from off-topic questions (≤ ~−7) much more clearly. Vague paraphrases still land in between, which is why there is an explicit "low confidence" tier rather than a threshold that pretends to be exact.

**Grounded generation** (`generate.ts`, `prompts.ts`):
- The system prompt requires answers to come only from the supplied documents, with `[S1]`-style citations. The model must not invent prices, hours or rules. It should say when the documents don't cover something, ask a clarifying question when needed, prefer the newer of two conflicting documents, treat document text as **untrusted data**, and never reveal prompts, keys or customer data.
- **Citation reconciliation.** The server keeps only citation labels that correspond to passages actually supplied, and strips anything else (e.g. a hallucinated `[S9]`).
- **No LLM configured, or the LLM failed?** The assistant returns an **extractive** answer: the most relevant passage quoted verbatim and labelled as such ("Quoted from documentation", plus a notice if the LLM failed). It never pretends to be generated.
- **Retrieval failed?** The assistant says it can't search the knowledge base right now (`mode: "error"`) and claims nothing. Booking is unaffected.

**Observability.** Each turn writes an `assistant_logs` row with intent, mode, provider, retrieval and generation milliseconds, retrieved chunk ids and token usage when the provider reports it. Message text and personal data are deliberately not stored.

**Evaluation.** `evals/rag-eval.json` holds 25 cases: 4 direct, 11 semantically phrased, 1 conflicting/outdated, 8 unanswerable and 1 needing clarification. Answerable cases pass when an expected document is judged relevant and no superseded document is retrieved. Unanswerable cases pass only if the assistant is **not confident**. Current result: **25/25**. Of the 16 answerable questions, 7 are answered with high confidence and 9 as "closest passage" (low confidence); of the 9 off-topic ones, 6 are rejected outright and 3 are flagged low-confidence. Run:

```bash
pnpm eval:rag      # PASS/FAIL per case with nearest document and distance; exit 1 on failure
```

---

## AI providers (free tiers)

The whole AI stack works **without any API key or paid service**:

- **Embeddings** default to `EMBEDDING_PROVIDER=local`. This runs `Xenova/bge-small-en-v1.5` in-process via transformers.js (ONNX on CPU), so it needs no key and costs nothing.
- **Generation** defaults to `LLM_PROVIDER=none`, which gives the extractive, cited answers described above.

To get fluent written answers, add a free key:

| Provider | Get a key | `.env` |
|---|---|---|
| **Groq** (recommended for speed) | https://console.groq.com | `LLM_PROVIDER="groq"`, `GROQ_API_KEY="…"` |
| **Google Gemini** | https://aistudio.google.com | `LLM_PROVIDER="gemini"`, `GEMINI_API_KEY="…"` |

When an LLM is configured it is used for two things:
- structured intent extraction, which is Zod-validated and falls back to the deterministic router;
- writing grounded answers.

To use Gemini for embeddings as well, set `EMBEDDING_PROVIDER="gemini"` (it requests 384-dimension vectors and re-normalises them), then run `pnpm kb:ingest --force`. Vectors from different models are never mixed: documents embedded with another model are excluded from search until they are re-processed. Changing the vector **dimension** requires a migration of `knowledge_chunks.embedding`.

---

## The assistant and its tools

`POST /api/assistant/chat` → `orchestrator.ts`:

1. **Intent routing.** The deterministic `router.ts` (keywords and slot-filling) is always available. It parses dates ("tomorrow", "next Friday", "14 Oct", ISO dates), times ("afternoon", "after 3pm", "at 10am"), budgets and booking references in the business time zone. If an LLM is configured, its JSON intent is validated with Zod and merged with the deterministic parse. Service ids are always resolved server-side from service *names*; the model never supplies ids.
2. **Tools** (`tools.ts`) are typed, validated functions over the same domain services as the REST API:
   - `search_services`: structured filters, plus semantic matching against the service catalogue;
   - `get_service_details`;
   - `get_available_slots`: **live SQL**;
   - `check_slot`;
   - `get_my_bookings` and `get_booking_details`: scoped to the session user;
   - `search_booking_policies`: RAG.
3. **No autonomous mutations.**
   - A booking request returns a **proposal**, or selectable slot chips. The user reviews it in the same confirmation dialog as the booking page, and only that click calls `POST /api/bookings`. The UI then shows the real API outcome, including 409.
   - Cancellation works the same way through `PATCH /api/bookings/:id/cancel`.
   - The backend re-validates everything no matter what the assistant said.
4. **Follow-ups** such as "what about Friday?" inherit the service and intent of the previous turn.
5. The endpoint is rate-limited (token bucket per user or IP).

---

## API reference

Responses are JSON. Errors use `{ "error": { "code", "message", "details?" } }`:

| Status | When |
|---|---|
| 400 | Validation error or malformed JSON |
| 401 | Not signed in |
| 403 | Not an administrator |
| 404 | Not found, or not yours |
| 409 | Conflict |
| 422 | Business rule violation |
| 429 | Rate limited |
| 500 | Server error (generic message, no stack trace) |

| Method & path | Auth | Description |
|---|---|---|
| `GET /api/services?q&category&maxPrice&maxDuration&page&pageSize` | public | Active services with `nextAvailableAt` |
| `GET /api/services/:idOrSlug` | public | One service |
| `GET /api/availability?serviceId&date=YYYY-MM-DD` | public | Day's slots with state `available`/`booked`/`blocked`/`closed` |
| `GET /api/availability/calendar?serviceId&from&days` | public | Bookable-slot counts per day |
| `POST /api/bookings` `{ slotId, notes? }` | customer | Create a booking → `201`, `409 SLOT_TAKEN`, `422 SLOT_CLOSED`/`SLOT_BLOCKED`/`SERVICE_INACTIVE` |
| `GET /api/bookings?view=upcoming\|past\|cancelled\|all&q&page` | customer | Own bookings (paginated) |
| `GET /api/bookings/:idOrReference` | customer | Own booking (404 otherwise) |
| `PATCH /api/bookings/:id/cancel` | customer | Cancel (idempotent); `422 CANCELLATION_WINDOW_CLOSED` inside 24 h |
| `GET, POST /api/admin/services` | admin | List with counts / create |
| `PATCH /api/admin/services/:id` | admin | Update; `422 SERVICE_HAS_BOOKINGS` for unsafe duration changes |
| `GET, POST /api/admin/availability` | admin | Opening-hour rules; `409 RULE_OVERLAP` |
| `DELETE /api/admin/availability/:id` | admin | Remove a rule (existing slots kept) |
| `GET /api/admin/slots?serviceId&from&days` | admin | Slots with active booking info |
| `POST /api/admin/slots` `{ serviceId, from, to }` | admin | Generate slots (idempotent, ≤ 62 days) |
| `PATCH /api/admin/slots/:id` `{ status }` | admin | Block or re-open; `409 SLOT_HAS_BOOKING` |
| `GET /api/admin/bookings?status&serviceId&q&from&to&page` | admin | All bookings |
| `GET, PATCH /api/admin/bookings/:id` `{ action: cancel\|complete }` | admin | Detail / state transition |
| `GET, POST /api/admin/knowledge/documents` | admin | List / add (JSON text or multipart upload) |
| `PATCH, DELETE /api/admin/knowledge/documents/:id` | admin | Retire or re-activate / delete (chunks cascade) |
| `POST /api/admin/knowledge/documents/:id/reprocess` | admin | Re-chunk and re-embed |
| `GET /api/admin/knowledge/documents/:id/chunks` | admin | Inspect indexed chunks |
| `POST /api/assistant/chat` `{ message, history[] }` | public* | Assistant turn (*bookings need a session) |

---

## Testing

```bash
pnpm typecheck            # next typegen + tsc --noEmit
pnpm lint
pnpm test:unit            # pure logic, no database
pnpm test:integration     # real PostgreSQL via TEST_DATABASE_URL (migrated automatically)
pnpm test:concurrency     # just the concurrency suite
pnpm test                 # unit + integration
pnpm eval:rag             # retrieval evaluation against the dev database
pnpm test:e2e             # Playwright (needs `pnpm db:setup`; first run: `npx playwright install chromium`)
```

Integration tests call the real route handlers and domain services against a real PostgreSQL database. Only Auth.js `auth()` is replaced by a test session. Coverage includes:

| # | Requirement | Test |
|---|---|---|
| 1 | Service listing | `booking-api` › lists only active services… |
| 2 | Available slot retrieval | `booking-api` › returns live slot states… |
| 3 | Successful booking | `booking-api` › creates a confirmed booking with a price snapshot |
| 4 | Duplicate booking rejection | `booking-api` › rejects a second booking… with 409 |
| 5 | Concurrent requests | `concurrency` (see below) |
| 6–7 | Cancellation, rebooking a cancelled slot | `booking-api` › cancels…releases…book it |
| 8 | Unauthorized cancellation | `booking-api` › does not let a customer cancel someone else's booking |
| 9 | Accessing another customer's booking | `booking-api` › hides other customers' bookings |
| 10 | Invalid and past slots | `booking-api` › rejects past, too-soon, blocked, inactive and unknown slots |
| 11 | Admin-only management | `admin-api` (401/403 on every admin endpoint, DB role re-check, idempotent generation, safe updates) |
| 12 | RAG returns relevant sources | `rag-assistant` › retrieves the cancellation policy…never the superseded version |
| 13 | Admits when KB can't answer | `rag-assistant` › says the documentation does not cover… |
| 14 | Uses live availability, not vectors | `rag-assistant` › answers availability…reflects a booking immediately |
| 15 | AI failure doesn't break booking | `rag-assistant` › reports a clear assistant error…while booking still works |
| – | DB constraints exist and hold | `db-constraints` |

### The concurrency test
`tests/integration/concurrency.test.ts` runs against the real test database. Each competing request uses its **own PrismaClient**, and therefore its own database connection, so the transactions really execute in parallel:
- **2 customers** book the same slot at once. Exactly one gets the booking, the other a `ConflictError` (409). Exactly one active row exists, and no stray rows remain.
- **10 customers** race for the same slot. Exactly one row remains.
- **Database-only proof.** Transaction 1 inserts an active booking and *holds its transaction open*. Transaction 2 inserts for the same slot; neither runs any application check. T2 blocks on T1's uncommitted index entry, then fails with the unique violation when T1 commits.
- **After a cancellation**, several racers compete for the freed slot. Exactly one wins.

Requirement: `TEST_DATABASE_URL` must point to a PostgreSQL database with `pgvector` and `btree_gist` that may be truncated (e.g. a Neon branch). The global setup runs `prisma migrate deploy` against it, and refuses to run if it equals `DATABASE_URL`/`DIRECT_URL`. The RAG tests download the local embedding model on first run.

---

## Deployment

- **Vercel or any Node host.** Set the env vars and run `pnpm build && pnpm start`. Run `pnpm db:migrate && pnpm db:verify` in the release step, against `DIRECT_URL`.
- **Database.** Use Neon's pooled URL for the app and the direct URL for migrations. Interactive transactions work through Neon's pooler.
- **Local embeddings** need the Node runtime (not Edge) and ~150 MB RAM for the model. On serverless platforms the model downloads on cold start unless `.cache/models` is bundled or cached. Alternatively set `EMBEDDING_PROVIDER=gemini`.
- **Before real customers:** set `DEMO_ACCOUNTS_ENABLED=false` and add a real Auth.js provider. Replace the in-memory rate limiter with Redis/Upstash or a DB-backed limiter. Run `pnpm db:seed` only for demo environments.
- **Slots** are generated ahead of time. Schedule a daily job, or use the admin "Generate slots" form, to keep the calendar published ahead.

---

## Architecture decisions

| Decision | Why |
|---|---|
| **Neon PostgreSQL for everything**, including vectors (pgvector) | One database for transactions and retrieval, simpler operations, and joins between chunks and document metadata |
| **Partial unique index as the double-booking guard** | Declarative and atomic. It works across processes and instances, and releases the slot automatically on cancellation |
| **Prisma 7 + `@prisma/adapter-pg`**, with raw SQL only where needed | Typed queries for the domain. Raw SQL is used for `FOR SHARE`/`FOR UPDATE` locking, vector search and `DISTINCT ON` |
| **Cache Components disabled** (`cacheComponents: false`) | Booking pages read live data on every request. Next 16's request-time model is simpler and avoids serving cached availability |
| **No LangChain**; a small custom RAG pipeline | Every step (validation, chunking, hashing, embedding, filtering, citation reconciliation) is explicit and testable, with no framework abstractions to explain |
| **Local embeddings by default** | Free, no key, deterministic, and works offline. The provider interface allows Gemini |
| **Extractive fallback** instead of failure | The assistant remains useful and honest without any paid or free LLM key |
| **Assistant tools are read-only** | Mutations always go through the same validated API and an explicit user confirmation |
| **Demo-account switcher** instead of auth pages | Requested for this demo. Server-side authorization is unchanged and ready for a real provider |
| **Money as integer minor units, time as `timestamptz`** | No floating-point rounding. All business rules are evaluated in `BUSINESS_TIMEZONE` and are DST-safe (tested) |

---

## Known limitations

- **No real login.** The demo switcher must be disabled, and a real provider added, before production use.
- **Rate limiting is in-memory**, per server instance.
- **Exclusive slots only.** There is no group-class capacity model.
- **No payment or PENDING holds**, so there is no expiry job.
- **No notifications.** There are no confirmation or reminder emails.
- **Slot generation is manual or seeded.** Rules don't auto-extend the calendar.
- **Chat history is not persisted** (`ChatSession`/`ChatMessage` aren't implemented). The client sends the last 6 turns with each request.
- **Hybrid search and reranking are not implemented.** Pure vector retrieval is adequate for this small knowledge base, and the eval set shows how well it performs.
- **Reranker thresholds are tuned on a 25-question eval set** for `bge-small-en-v1.5` + `ms-marco-MiniLM-L-6-v2`. Re-tune them with `pnpm eval:rag` if you change either model.
- **Many paraphrased questions get "low confidence"** with the small local models: the assistant quotes the closest passage and says it may not answer. Adding a free Groq/Gemini key lets the LLM write a direct answer from those passages.
- **Local models download on first use**: ~35 MB for embeddings and ~90 MB for the reranker, cached in `.cache/models`.
- **LLM-written answers** (Groq/Gemini) need a free API key. Without one, answers are extractive quotes.
