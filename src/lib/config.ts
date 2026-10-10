import { z } from "zod";

/**
 * Server-side runtime configuration. Parsed lazily so that client bundles and
 * build steps that never touch these values do not fail on missing env vars.
 * Never import this from a Client Component — it reads secrets.
 */
const intFromEnv = (fallback: number) =>
  z.preprocess((v) => (v === undefined || v === "" ? fallback : Number(v)), z.number().int());

const floatFromEnv = (fallback: number) =>
  z.preprocess((v) => (v === undefined || v === "" ? fallback : Number(v)), z.number());

const ConfigSchema = z.object({
  BUSINESS_TIMEZONE: z.string().default("Asia/Kolkata"),
  CANCELLATION_CUTOFF_HOURS: intFromEnv(24).pipe(z.number().min(0).max(720)),
  BOOKING_MIN_LEAD_MINUTES: intFromEnv(60).pipe(z.number().min(0).max(10080)),

  EMBEDDING_PROVIDER: z.enum(["local", "gemini", "fake"]).default("local"),
  EMBEDDING_MODEL: z.string().default("Xenova/bge-small-en-v1.5"),

  LLM_PROVIDER: z.enum(["none", "groq", "gemini"]).default("none"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  LLM_TIMEOUT_MS: intFromEnv(20000).pipe(z.number().min(1000).max(120000)),

  RAG_TOP_K: intFromEnv(5).pipe(z.number().min(1).max(20)),
  RAG_CHUNK_SIZE: intFromEnv(800).pipe(z.number().min(200).max(4000)),
  RAG_CHUNK_OVERLAP: intFromEnv(120).pipe(z.number().min(0).max(1000)),
  /** Candidate pre-filter on cosine distance (0 = identical). Loose by design; the reranker decides relevance. */
  RAG_MAX_DISTANCE: floatFromEnv(0.6).pipe(z.number().min(0).max(2)),
  RAG_CANDIDATES: intFromEnv(12).pipe(z.number().min(1).max(50)),
  RAG_RERANK: z.preprocess((v) => (v === undefined || v === "" ? true : String(v).toLowerCase() === "true"), z.boolean()),
  RAG_RERANK_MODEL: z.string().default("Xenova/ms-marco-MiniLM-L-6-v2"),
  /** Cross-encoder logit below which a passage is treated as not covering the question. Tuned with `pnpm eval:rag`. */
  RAG_MIN_RERANK_SCORE: floatFromEnv(-10.6).pipe(z.number().min(-50).max(50)),
  /** At or above this logit the top passage is treated as a confident, direct match. */
  RAG_CONFIDENT_RERANK_SCORE: floatFromEnv(0).pipe(z.number().min(-50).max(50)),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cached) {
    const parsed = ConfigSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test helper — forces the next getConfig() call to re-read process.env. */
export function resetConfigCache() {
  cached = null;
}

export const EMBEDDING_DIMENSIONS = 384;
