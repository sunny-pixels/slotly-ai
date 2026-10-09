import { requireAdmin } from "@/server/authz";
import { json, parseWith, route } from "@/server/http";
import { getDocumentChunks } from "@/server/rag/ingest";
import { idSchema } from "@/lib/validators";

/** Lets administrators inspect exactly which text the assistant can retrieve. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  await requireAdmin();
  return json({ document: await getDocumentChunks(parseWith(idSchema, (await params).id)) });
});
