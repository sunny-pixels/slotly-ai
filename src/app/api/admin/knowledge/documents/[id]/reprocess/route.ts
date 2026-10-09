import { requireAdmin } from "@/server/authz";
import { json, parseWith, route } from "@/server/http";
import { reprocessDocument } from "@/server/rag/ingest";
import { idSchema } from "@/lib/validators";

export const maxDuration = 120;

/** Re-chunks and re-embeds the stored text (after changing chunking settings or embedding model). */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  await requireAdmin();
  const result = await reprocessDocument(parseWith(idSchema, (await params).id));
  return json({ result }, { status: result.status === "READY" ? 200 : 502 });
});
