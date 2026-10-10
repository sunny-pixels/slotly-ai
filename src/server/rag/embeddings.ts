import { modelCacheDir } from "./model-cache";
import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSIONS, getConfig } from "@/lib/config";

/**
 * Embedding providers. All return L2-normalised 384-dimension vectors so that
 * pgvector cosine distance is meaningful. Changing the dimension requires a
 * migration of `knowledge_chunks.embedding`.
 *
 *  - local  : Xenova/bge-small-en-v1.5 via transformers.js, in-process, free, no key.
 *  - gemini : gemini-embedding-001 with outputDimensionality=384 (free-tier key).
 *  - fake   : deterministic hashed bag-of-words — unit tests only.
 */
export type EmbedKind = "query" | "document";

export interface EmbeddingProvider {
  /** Stable identifier stored with each document (vectors of different models are incomparable). */
  readonly id: string;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmbeddingError";
  }
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function assertDims(vectors: number[][]) {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingError(`Embedding has ${v.length} dimensions, expected ${EMBEDDING_DIMENSIONS}.`);
    }
  }
  return vectors;
}

// ── Local (transformers.js) ──────────────────────────────────────────────────

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

const BGE_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: ";

class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  private extractor: Promise<FeatureExtractor> | null = null;

  constructor(private readonly model: string) {
    this.id = `local:${model}`;
  }

  private load(): Promise<FeatureExtractor> {
    if (!this.extractor) {
      this.extractor = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        env.cacheDir = modelCacheDir();
        const fe = await pipeline("feature-extraction", this.model, { dtype: "fp32" });
        return fe as unknown as FeatureExtractor;
      })().catch((error) => {
        this.extractor = null; // allow a retry on the next request
        throw new EmbeddingError("The local embedding model could not be loaded.", { cause: error });
      });
    }
    return this.extractor;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    if (texts.length === 0) return [];
    const fe = await this.load();
    const isBge = this.model.toLowerCase().includes("bge");
    const inputs = kind === "query" && isBge ? texts.map((t) => BGE_QUERY_INSTRUCTION + t) : texts;
    const out: number[][] = [];
    for (let i = 0; i < inputs.length; i += 16) {
      const batch = await fe(inputs.slice(i, i + 16), { pooling: isBge ? "cls" : "mean", normalize: true });
      out.push(...batch.tolist());
    }
    return assertDims(out);
  }
}

// ── Gemini ───────────────────────────────────────────────────────────────────

class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly id = "gemini:gemini-embedding-001@384";

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 50) {
      const batch = texts.slice(i, i + 50);
      let res: Response;
      try {
        res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
            body: JSON.stringify({
              requests: batch.map((text) => ({
                model: "models/gemini-embedding-001",
                content: { parts: [{ text }] },
                taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
                outputDimensionality: EMBEDDING_DIMENSIONS,
              })),
            }),
            signal: AbortSignal.timeout(this.timeoutMs),
          },
        );
      } catch (error) {
        throw new EmbeddingError("The Gemini embedding service did not respond.", { cause: error });
      }
      if (!res.ok) throw new EmbeddingError(`Gemini embeddings failed with HTTP ${res.status}.`);
      const data = (await res.json()) as { embeddings?: { values: number[] }[] };
      if (!data.embeddings || data.embeddings.length !== batch.length) {
        throw new EmbeddingError("Gemini returned an unexpected embeddings payload.");
      }
      // Truncated (Matryoshka) Gemini vectors must be re-normalised.
      out.push(...data.embeddings.map((e) => normalize(e.values)));
    }
    return assertDims(out);
  }
}

// ── Fake (tests) ─────────────────────────────────────────────────────────────

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = "fake:hashed-bow";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      for (const token of tokens) {
        const stem = token.length > 4 ? token.slice(0, 5) : token;
        const h = createHash("md5").update(stem).digest();
        v[h.readUInt16BE(0) % EMBEDDING_DIMENSIONS] += 1;
      }
      if (tokens.length === 0) v[0] = 1;
      return normalize(v);
    });
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

let provider: EmbeddingProvider | null = null;
let override: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (override) return override;
  if (provider) return provider;
  const config = getConfig();
  switch (config.EMBEDDING_PROVIDER) {
    case "gemini":
      if (!config.GEMINI_API_KEY) throw new EmbeddingError("EMBEDDING_PROVIDER=gemini but GEMINI_API_KEY is not set.");
      provider = new GeminiEmbeddingProvider(config.GEMINI_API_KEY, config.LLM_TIMEOUT_MS);
      break;
    case "fake":
      provider = new FakeEmbeddingProvider();
      break;
    default:
      provider = new LocalEmbeddingProvider(config.EMBEDDING_MODEL);
  }
  return provider;
}

/** Test hook: substitute a provider (e.g. one that throws, to simulate an outage). */
export function setEmbeddingProviderForTests(p: EmbeddingProvider | null) {
  override = p;
}

/** pgvector text literal, e.g. "[0.1,0.2,…]". */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(7) : "0")).join(",")}]`;
}
