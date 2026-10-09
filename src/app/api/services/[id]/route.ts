import { json, parseWith, route } from "@/server/http";
import { getService } from "@/server/services/catalog";
import { idSchema } from "@/lib/validators";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const id = parseWith(idSchema, (await params).id);
  return json({ service: await getService(id) });
});
