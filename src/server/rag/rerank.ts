import path from "node:path";
import { getConfig } from "@/lib/config";

/**
 * Cross-encoder reranking. Bi-encoder (embedding) distance is good for recall
 * but poorly calibrated for "is this passage actually about the question?".
 * A cross-encoder reads the question and passage together and returns a
 * relevance logit, which `retrieve()` uses to order candidates and to decide
 * whether the knowledge base covers the question at all (see evals/).
 *
 * Model: Xenova/ms-marco-MiniLM-L-6-v2 — runs locally via transformers.js, free.
 */
export interface Reranker {
  readonly id: string;
  score(query: string, passages: string[]): Promise<number[]>;
}

type Tokenizer = (a: string[], o: { text_pair: string[]; padding: boolean; truncation: boolean }) => unknown;
type Model = (inputs: unknown) => Promise<{ logits: { data: Float32Array } }>;

class LocalCrossEncoder implements Reranker {
  readonly id: string;
  private loaded: Promise<{ tokenizer: Tokenizer; model: Model }> | null = null;

  constructor(private readonly modelId: string) {
    this.id = `local:${modelId}`;
  }

  private load() {
    if (!this.loaded) {
      this.loaded = (async () => {
        const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import("@huggingface/transformers");
        env.cacheDir = path.join(process.cwd(), ".cache", "models");
        const tokenizer = (await AutoTokenizer.from_pretrained(this.modelId)) as unknown as Tokenizer;
        const model = (await AutoModelForSequenceClassification.from_pretrained(this.modelId, { dtype: "fp32" })) as unknown as Model;
        return { tokenizer, model };
      })().catch((error) => {
        this.loaded = null;
        throw error;
      });
    }
    return this.loaded;
  }

  async score(query: string, passages: string[]): Promise<number[]> {
    if (passages.length === 0) return [];
    const { tokenizer, model } = await this.load();
    const inputs = tokenizer(new Array(passages.length).fill(query), { text_pair: passages, padding: true, truncation: true });
    const { logits } = await model(inputs);
    return Array.from(logits.data);
  }
}

let instance: Reranker | null = null;
let override: Reranker | null | undefined;

/** Returns the reranker, or null when RAG_RERANK=false. */
export function getReranker(): Reranker | null {
  if (override !== undefined) return override;
  const config = getConfig();
  if (!config.RAG_RERANK) return null;
  instance ??= new LocalCrossEncoder(config.RAG_RERANK_MODEL);
  return instance;
}

/** Test hook: `undefined` restores env-based selection, `null` disables reranking. */
export function setRerankerForTests(r: Reranker | null | undefined) {
  override = r;
}
