import { z } from "zod";
import { requireAdmin } from "@/server/authz";
import { ValidationError } from "@/server/errors";
import { json, parseWith, readJson, route } from "@/server/http";
import {
  ALLOWED_EXTENSIONS,
  ingestDocument,
  listDocuments,
  MAX_DOCUMENT_BYTES,
  slugFromTitle,
} from "@/server/rag/ingest";
import { knowledgeTextSchema } from "@/lib/validators";

// Embedding a large document locally can take a while.
export const maxDuration = 120;

export const GET = route(async () => {
  await requireAdmin();
  return json({ documents: await listDocuments() });
});

const ALLOWED_MIME = new Set(["text/plain", "text/markdown", "text/x-markdown", "application/octet-stream", ""]);

/**
 * Adds or replaces a knowledge document, either as JSON `{ title, category, content }`
 * or as a multipart upload (`file` + `title` + `category`). Only UTF-8 text
 * (.md/.markdown/.txt, ≤ 512 KB) is accepted; content is never executed or rendered as HTML.
 */
export const POST = route(async (req) => {
  await requireAdmin();
  const type = req.headers.get("content-type") ?? "";

  let input: z.output<typeof knowledgeTextSchema>;
  let sourceType: "UPLOAD" | "TEXT";

  if (type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => {
      throw new ValidationError("Malformed upload.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Attach a .md or .txt file.");
    const name = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      throw new ValidationError(`Only ${ALLOWED_EXTENSIONS.join(", ")} files are accepted.`);
    }
    if (!ALLOWED_MIME.has(file.type)) throw new ValidationError(`Unsupported file type “${file.type}”.`);
    if (file.size > MAX_DOCUMENT_BYTES) throw new ValidationError(`Files are limited to ${MAX_DOCUMENT_BYTES / 1024} KB.`);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      throw new ValidationError("The file is not valid UTF-8 text.");
    }
    if (text.includes("\u0000")) throw new ValidationError("The file looks binary, not text.");
    input = parseWith(knowledgeTextSchema, {
      title: form.get("title") || file.name.replace(/\.[^.]+$/, ""),
      category: form.get("category") || "general",
      content: text,
      slug: form.get("slug") || undefined,
    });
    sourceType = "UPLOAD";
  } else {
    input = parseWith(knowledgeTextSchema, await readJson(req));
    sourceType = "TEXT";
  }

  const result = await ingestDocument({
    slug: input.slug ?? slugFromTitle(input.title),
    title: input.title,
    category: input.category,
    content: input.content,
    sourceType,
  });
  return json({ result }, { status: result.status === "READY" ? 201 : 502 });
});
