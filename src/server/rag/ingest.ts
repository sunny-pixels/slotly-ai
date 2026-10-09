import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { getConfig } from "@/lib/config";
import { chunkDocument, normalizeText } from "./chunker";
import { getEmbeddingProvider, toVectorLiteral } from "./embeddings";

export const KNOWLEDGE_CATEGORIES = ["policy", "faq", "services", "hours", "general"] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const ALLOWED_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

export type IngestInput = {
  slug: string;
  title: string;
  category: KnowledgeCategory;
  content: string;
  sourceType: "SEED" | "UPLOAD" | "TEXT";
  effectiveDate?: Date | null;
  isActive?: boolean;
  supersededBy?: string | null;
};

export type IngestResult = {
  documentId: string;
  status: "READY" | "FAILED";
  skipped: boolean;
  chunkCount: number;
  version: number;
  error?: string;
};

export const contentHash = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Validates, normalises, chunks, embeds and stores one document.
 *
 * Idempotent: if a document with the same slug already holds the same content
 * hash, embedded by the same model, nothing is re-embedded (so seeding or
 * restarting never duplicates vectors). Changed content bumps `version` and
 * atomically replaces the document's chunks.
 */
export async function ingestDocument(input: IngestInput, opts: { force?: boolean } = {}): Promise<IngestResult> {
  const content = normalizeText(input.content);
  if (content.length < 20) throw new ValidationError("The document is empty or too short to index.");
  if (Buffer.byteLength(content, "utf8") > MAX_DOCUMENT_BYTES) {
    throw new ValidationError(`Documents are limited to ${MAX_DOCUMENT_BYTES / 1024} KB.`);
  }

  const provider = getEmbeddingProvider();
  const hash = contentHash(content);
  const existing = await prisma.knowledgeDocument.findUnique({ where: { slug: input.slug } });

  const metadata = {
    title: input.title,
    category: input.category,
    sourceType: input.sourceType,
    effectiveDate: input.effectiveDate ?? null,
    isActive: input.isActive ?? true,
    supersededBy: input.supersededBy ?? null,
  };

  if (
    existing &&
    !opts.force &&
    existing.contentHash === hash &&
    existing.status === "READY" &&
    existing.embeddingModel === provider.id
  ) {
    await prisma.knowledgeDocument.update({ where: { id: existing.id }, data: metadata });
    return { documentId: existing.id, status: "READY", skipped: true, chunkCount: existing.chunkCount, version: existing.version };
  }

  const version = existing ? (existing.contentHash === hash ? existing.version : existing.version + 1) : 1;
  const doc = existing
    ? await prisma.knowledgeDocument.update({
        where: { id: existing.id },
        data: { ...metadata, content, contentHash: hash, version, status: "PROCESSING", error: null },
      })
    : await prisma.knowledgeDocument.create({
        data: { ...metadata, slug: input.slug, content, contentHash: hash, version, status: "PROCESSING" },
      });

  return embedAndStore(doc.id, content, version, provider);
}

async function embedAndStore(
  documentId: string,
  content: string,
  version: number,
  provider = getEmbeddingProvider(),
): Promise<IngestResult> {
  const { RAG_CHUNK_SIZE, RAG_CHUNK_OVERLAP } = getConfig();
  try {
    const chunks = chunkDocument(content, { chunkSize: RAG_CHUNK_SIZE, overlap: RAG_CHUNK_OVERLAP });
    if (chunks.length === 0) throw new ValidationError("No indexable text was found in the document.");
    const vectors = await provider.embed(
      chunks.map((c) => c.content),
      "document",
    );

    await prisma.$transaction(
      async (tx) => {
        await tx.knowledgeChunk.deleteMany({ where: { documentId } });
        for (let i = 0; i < chunks.length; i += 100) {
          const rows = chunks.slice(i, i + 100).map(
            (c, j) =>
              Prisma.sql`(${randomUUID()}, ${documentId}, ${c.index}, ${c.content}, ${c.headingPath}, ${c.tokenEstimate}, ${toVectorLiteral(vectors[i + j])}::vector, now())`,
          );
          await tx.$executeRaw`
            INSERT INTO knowledge_chunks (id, document_id, chunk_index, content, heading_path, token_estimate, embedding, created_at)
            VALUES ${Prisma.join(rows)}`;
        }
        await tx.knowledgeDocument.update({
          where: { id: documentId },
          data: {
            status: "READY",
            error: null,
            chunkCount: chunks.length,
            embeddingModel: provider.id,
            ingestedAt: new Date(),
          },
        });
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    return { documentId, status: "READY", skipped: false, chunkCount: chunks.length, version };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion error";
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "FAILED", error: message.slice(0, 500), chunkCount: 0 },
    });
    await prisma.knowledgeChunk.deleteMany({ where: { documentId } });
    return { documentId, status: "FAILED", skipped: false, chunkCount: 0, version, error: message };
  }
}

/** Re-chunks and re-embeds a stored document (e.g. after changing chunk size or embedding model). */
export async function reprocessDocument(id: string): Promise<IngestResult> {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError("Document not found.");
  await prisma.knowledgeDocument.update({ where: { id }, data: { status: "PROCESSING", error: null } });
  return embedAndStore(doc.id, doc.content, doc.version);
}

export async function deleteDocument(id: string) {
  const res = await prisma.knowledgeDocument.deleteMany({ where: { id } }); // chunks cascade
  if (res.count === 0) throw new NotFoundError("Document not found.");
}

export async function setDocumentActive(id: string, isActive: boolean) {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id }, select: { id: true } });
  if (!doc) throw new NotFoundError("Document not found.");
  return prisma.knowledgeDocument.update({ where: { id }, data: { isActive }, select: { id: true, isActive: true } });
}

export async function listDocuments() {
  return prisma.knowledgeDocument.findMany({
    orderBy: [{ isActive: "desc" }, { category: "asc" }, { title: "asc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      category: true,
      sourceType: true,
      version: true,
      status: true,
      error: true,
      chunkCount: true,
      isActive: true,
      supersededBy: true,
      effectiveDate: true,
      embeddingModel: true,
      ingestedAt: true,
      updatedAt: true,
      contentHash: true,
    },
  });
}

export async function getDocumentChunks(id: string) {
  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      slug: true,
      chunks: { orderBy: { chunkIndex: "asc" }, select: { id: true, chunkIndex: true, headingPath: true, content: true, tokenEstimate: true } },
    },
  });
  if (!doc) throw new NotFoundError("Document not found.");
  return doc;
}

export function slugFromTitle(title: string) {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 70) || `doc-${Date.now()}`
  );
}
