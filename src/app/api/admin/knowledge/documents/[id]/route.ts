import { z } from "zod";
import { requireAdmin } from "@/server/authz";
import { json, parseWith, readJson, route } from "@/server/http";
import { deleteDocument, setDocumentActive } from "@/server/rag/ingest";
import { idSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/** Removes a document and (via ON DELETE CASCADE) all of its chunks and vectors. */
export const DELETE = route<Ctx>(async (_req, { params }) => {
  await requireAdmin();
  await deleteDocument(parseWith(idSchema, (await params).id));
  return json({ ok: true });
});

/** Activate / retire a document without deleting it. Inactive documents are never retrieved. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  await requireAdmin();
  const id = parseWith(idSchema, (await params).id);
  const { isActive } = parseWith(z.object({ isActive: z.boolean() }), await readJson(req));
  return json({ document: await setDocumentActive(id, isActive) });
});
