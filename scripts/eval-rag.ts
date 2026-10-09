/**
 * pnpm eval:rag — runs evals/rag-eval.json against the live knowledge base.
 *
 * Pass criteria
 *  - answerable cases: an expected document is among the *relevant* passages
 *    (after reranking), and no forbidden (e.g. superseded) document is retrieved;
 *  - unanswerable cases: the assistant must NOT be confident — either nothing is
 *    relevant ("not covered") or the match is flagged low-confidence ("closest
 *    passage, may not answer"). A confident answer to an off-topic question fails.
 *
 * Uses the configured embedding provider and reranker; no LLM needed.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/server/db";
import { retrieve } from "../src/server/rag/retrieve";
import { getConfig } from "../src/lib/config";

type EvalCase = {
  id: string;
  type: string;
  question: string;
  expect?: string[];
  forbid?: string[];
  answerable?: boolean;
};

async function main() {
  const { cases } = JSON.parse(await readFile("evals/rag-eval.json", "utf8")) as { cases: EvalCase[] };
  const c = getConfig();
  console.log(
    `top-k=${c.RAG_TOP_K} candidates=${c.RAG_CANDIDATES} max-distance=${c.RAG_MAX_DISTANCE} rerank=${c.RAG_RERANK ? c.RAG_RERANK_MODEL : "off"} floor=${c.RAG_MIN_RERANK_SCORE} confident≥${c.RAG_CONFIDENT_RERANK_SCORE}\n`,
  );

  let passed = 0;
  const tally = { high: 0, low: 0, none: 0 };
  for (const tc of cases) {
    const r = await retrieve(tc.question);
    const relevantSlugs = [...new Set(r.relevant.map((x) => x.documentSlug))];
    const top = r.chunks[0];
    const problems: string[] = [];

    if (tc.answerable === false) {
      if (r.confidence === "high") problems.push(`confident answer to an off-topic question (${relevantSlugs.join(", ")})`);
    } else {
      tally[r.confidence]++;
      if (tc.expect && !tc.expect.some((s) => relevantSlugs.includes(s))) problems.push(`none of [${tc.expect.join(", ")}] judged relevant`);
      const leaked = (tc.forbid ?? []).filter((s) => r.chunks.some((x) => x.documentSlug === s));
      if (leaked.length) problems.push(`forbidden source retrieved: ${leaked.join(", ")}`);
    }

    const ok = problems.length === 0;
    if (ok) passed++;
    const score = top?.rerankScore != null ? `rerank=${top.rerankScore.toFixed(2)}` : "";
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${tc.id.padEnd(26)} ${tc.type.padEnd(13)} ${r.confidence.padEnd(4)}  top=${top ? `${top.documentSlug} d=${top.distance.toFixed(3)} ${score}` : "—"}  ${r.embeddingMs + r.searchMs + r.rerankMs}ms${problems.length ? `\n      ↳ ${problems.join("; ")}` : ""}`,
    );
  }
  console.log(`\n${passed}/${cases.length} cases passed. Answerable cases by confidence: high=${tally.high} low=${tally.low} none=${tally.none}.`);
  if (passed < cases.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
