import { listDocuments } from "@/server/rag/ingest";
import { getEmbeddingProvider } from "@/server/rag/embeddings";
import { getLlm } from "@/server/rag/llm";
import { getConfig } from "@/lib/config";
import { PageBody, PageHeader } from "@/components/common/page";
import { KnowledgeAdmin } from "@/components/admin/knowledge-admin";

export const metadata = { title: "Knowledge base" };

export default async function KnowledgeBasePage() {
  const docs = await listDocuments();
  const config = getConfig();
  let embeddingId = "unavailable";
  try {
    embeddingId = getEmbeddingProvider().id;
  } catch {
    // misconfigured provider — shown in the panel
  }
  const llm = getLlm();

  return (
    <PageBody>
      <PageHeader
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Knowledge base" }]}
        title="Knowledge base"
        description="Documents the assistant may quote. Only active, successfully indexed documents are searched; customer bookings are never added here."
      />
      <KnowledgeAdmin
        documents={docs.map((d) => ({
          ...d,
          effectiveDate: d.effectiveDate?.toISOString().slice(0, 10) ?? null,
          ingestedAt: d.ingestedAt?.toISOString() ?? null,
          updatedAt: d.updatedAt.toISOString(),
        }))}
        pipeline={{
          embedding: embeddingId,
          llm: llm ? `${llm.name} · ${llm.model}` : "Off (extractive answers)",
          topK: config.RAG_TOP_K,
          chunkSize: config.RAG_CHUNK_SIZE,
          overlap: config.RAG_CHUNK_OVERLAP,
          maxDistance: config.RAG_MAX_DISTANCE,
        }}
        timeZone={config.BUSINESS_TIMEZONE}
      />
    </PageBody>
  );
}
