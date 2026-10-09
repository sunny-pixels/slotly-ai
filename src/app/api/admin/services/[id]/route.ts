import { requireAdmin } from "@/server/authz";
import { json, parseWith, readJson, route } from "@/server/http";
import { updateService } from "@/server/services/catalog";
import { idSchema, updateServiceSchema } from "@/lib/validators";

/** There is deliberately no DELETE: services are deactivated so booking history stays intact. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireAdmin();
  const id = parseWith(idSchema, (await params).id);
  const patch = parseWith(updateServiceSchema, await readJson(req));
  return json(await updateService(id, patch));
});
