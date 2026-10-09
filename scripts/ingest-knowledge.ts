/**
 * pnpm kb:ingest            — ingest /knowledge/*.md (unchanged documents are skipped)
 * pnpm kb:ingest --force    — re-chunk and re-embed everything
 */
import "dotenv/config";
import { prisma } from "../src/server/db";
import { ingestKnowledgeDirectory } from "../src/server/rag/knowledge-files";
import { getEmbeddingProvider } from "../src/server/rag/embeddings";

async function main() {
  const force = process.argv.includes("--force");
  console.log(`Embedding provider: ${getEmbeddingProvider().id}${force ? " (forced re-embed)" : ""}`);
  const results = await ingestKnowledgeDirectory({ force, log: (l) => console.log(l) });
  const failed = results.filter((r) => r.status === "FAILED").length;
  console.log(`${results.length} documents, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
