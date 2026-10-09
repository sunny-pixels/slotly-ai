import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ingestDocument, KNOWLEDGE_CATEGORIES, type IngestResult, type KnowledgeCategory } from "./ingest";

/**
 * Loads the version-controlled demo knowledge base from /knowledge/*.md.
 * Each file has a small YAML-like front-matter block:
 *   title, category, effective (YYYY-MM-DD), active (true|false), supersededBy (slug)
 */
export type KnowledgeFile = {
  slug: string;
  title: string;
  category: KnowledgeCategory;
  effectiveDate: Date | null;
  isActive: boolean;
  supersededBy: string | null;
  content: string;
};

export function parseKnowledgeFile(fileName: string, raw: string): KnowledgeFile {
  const slug = path.basename(fileName).replace(/\.(md|markdown|txt)$/i, "");
  const match = raw.replace(/\r\n?/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta: Record<string, string> = {};
  const body = match ? match[2] : raw;
  if (match) {
    for (const line of match[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }
  const category = (KNOWLEDGE_CATEGORIES as readonly string[]).includes(meta.category) ? (meta.category as KnowledgeCategory) : "general";
  return {
    slug,
    title: meta.title || slug,
    category,
    effectiveDate: meta.effective ? new Date(`${meta.effective}T00:00:00Z`) : null,
    isActive: meta.active !== "false",
    supersededBy: meta.supersededBy || null,
    content: body.trim(),
  };
}

export async function loadKnowledgeDirectory(dir = path.join(process.cwd(), "knowledge")): Promise<KnowledgeFile[]> {
  const names = (await readdir(dir)).filter((n) => /\.(md|markdown|txt)$/i.test(n)).sort();
  return Promise.all(names.map(async (n) => parseKnowledgeFile(n, await readFile(path.join(dir, n), "utf8"))));
}

/** Ingests every file; unchanged documents are skipped (content hash + embedding model match). */
export async function ingestKnowledgeDirectory(opts: { force?: boolean; log?: (line: string) => void } = {}) {
  const files = await loadKnowledgeDirectory();
  const results: (IngestResult & { slug: string })[] = [];
  for (const f of files) {
    const r = await ingestDocument(
      {
        slug: f.slug,
        title: f.title,
        category: f.category,
        content: f.content,
        sourceType: "SEED",
        effectiveDate: f.effectiveDate,
        isActive: f.isActive,
        supersededBy: f.supersededBy,
      },
      { force: opts.force },
    );
    results.push({ ...r, slug: f.slug });
    opts.log?.(
      `${r.status === "READY" ? (r.skipped ? "unchanged" : "ingested ") : "FAILED   "} ${f.slug.padEnd(28)} v${r.version} ${r.chunkCount} chunks${r.error ? ` — ${r.error}` : ""}`,
    );
  }
  return results;
}
