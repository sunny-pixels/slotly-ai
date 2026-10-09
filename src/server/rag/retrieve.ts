import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { getConfig } from "@/lib/config";
import { getEmbeddingProvider, toVectorLiteral } from "./embeddings";
import { getReranker } from "./rerank";

export type RetrievedChunk = {
  rank: number;
  chunkId: string;
  documentId: string;
  documentSlug: string;
  documentTitle: string;
  category: string;
  version: number;
  headingPath: string;
  content: string;
  /** pgvector cosine distance (0 = identical direction). Real value — never rescaled into a "confidence". */
  distance: number;
  /** Cross-encoder relevance logit, when reranking ran. */
  rerankScore: number | null;
};

export type RetrievalResult = {
  query: string;
  /** Candidates after ranking, best first (at most RAG_TOP_K). */
  chunks: RetrievedChunk[];
  /** Candidates judged relevant — the only ones given to the LLM or shown as sources. */
  relevant: RetrievedChunk[];
  /**
   * high — the best passage is a direct match (reranker score ≥ RAG_CONFIDENT_RERANK_SCORE);
   * low  — something related was found but it may not answer the question;
   * none — the knowledge base does not cover the question.
   */
  confidence: "high" | "low" | "none";
  reranked: boolean;
  embeddingMs: number;
  searchMs: number;
  rerankMs: number;
};

export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, 500);
}

/**
 * 1. Embed the query and take the nearest chunks from pgvector — only active,
 *    READY documents embedded by the current model (customer data is never indexed).
 * 2. Rerank the candidates with a cross-encoder and drop those below the
 *    relevance floor. If the reranker is unavailable, fall back to distance
 *    order and report low confidence rather than failing.
 */
export async function retrieve(
  rawQuery: string,
  opts: { topK?: number; categories?: string[]; maxDistance?: number; rerank?: boolean } = {},
): Promise<RetrievalResult> {
  const config = getConfig();
  const query = normalizeQuery(rawQuery);
  const empty: RetrievalResult = { query, chunks: [], relevant: [], confidence: "none", reranked: false, embeddingMs: 0, searchMs: 0, rerankMs: 0 };
  if (!query) return empty;
  const topK = Math.min(Math.max(opts.topK ?? config.RAG_TOP_K, 1), 20);
  const maxDistance = opts.maxDistance ?? config.RAG_MAX_DISTANCE;
  const provider = getEmbeddingProvider();

  const t0 = performance.now();
  const [vector] = await provider.embed([query], "query");
  const t1 = performance.now();

  const literal = toVectorLiteral(vector);
  const categoryFilter =
    opts.categories && opts.categories.length > 0 ? Prisma.sql`AND d.category = ANY(${opts.categories}::text[])` : Prisma.empty;

  const rows = await prisma.$queryRaw<
    {
      chunk_id: string;
      document_id: string;
      slug: string;
      title: string;
      category: string;
      version: number;
      heading_path: string;
      content: string;
      distance: number;
    }[]
  >`
    SELECT c.id AS chunk_id, d.id AS document_id, d.slug, d.title, d.category, d.version,
           c.heading_path, c.content, (c.embedding <=> ${literal}::vector)::float8 AS distance
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id
    WHERE d.is_active = true
      AND d.status = 'READY'
      AND d.embedding_model = ${provider.id}
      AND c.embedding IS NOT NULL
      ${categoryFilter}
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT ${Math.max(topK, config.RAG_CANDIDATES)}`;
  const t2 = performance.now();

  let candidates: RetrievedChunk[] = rows
    .map((r) => ({
      rank: 0,
      chunkId: r.chunk_id,
      documentId: r.document_id,
      documentSlug: r.slug,
      documentTitle: r.title,
      category: r.category,
      version: r.version,
      headingPath: r.heading_path,
      content: r.content,
      distance: Number(r.distance),
      rerankScore: null as number | null,
    }))
    .filter((c) => c.distance <= maxDistance);

  // ── Rerank ────────────────────────────────────────────────────────────────
  const reranker = opts.rerank === false ? null : getReranker();
  let reranked = false;
  if (reranker && candidates.length > 0) {
    try {
      const scores = await reranker.score(
        query,
        candidates.map((c) => c.content),
      );
      candidates = candidates.map((c, i) => ({ ...c, rerankScore: scores[i] })).sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
      reranked = true;
    } catch (error) {
      console.warn("[rag] reranker unavailable, using vector order:", error instanceof Error ? error.message : error);
    }
  }
  const t3 = performance.now();

  const chunks = candidates.slice(0, topK).map((c, i) => ({ ...c, rank: i + 1 }));
  const relevant = reranked ? chunks.filter((c) => (c.rerankScore ?? -Infinity) >= config.RAG_MIN_RERANK_SCORE) : chunks;
  const top = relevant[0];
  const confidence: RetrievalResult["confidence"] = !top
    ? "none"
    : reranked && (top.rerankScore ?? -Infinity) >= config.RAG_CONFIDENT_RERANK_SCORE
      ? "high"
      : "low";

  return {
    query,
    chunks,
    relevant,
    confidence,
    reranked,
    embeddingMs: Math.round(t1 - t0),
    searchMs: Math.round(t2 - t1),
    rerankMs: Math.round(t3 - t2),
  };
}
