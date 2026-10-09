import { requireAdmin } from "@/server/authz";
import { json, parseWith, readJson, route } from "@/server/http";
import { setSlotStatus } from "@/server/services/scheduling";
import { idSchema, updateSlotSchema } from "@/lib/validators";

/** Block or re-open a slot. Blocking a slot with an active booking returns 409. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireAdmin();
  const id = parseWith(idSchema, (await params).id);
  const { status } = parseWith(updateSlotSchema, await readJson(req));
  return json({ slot: await setSlotStatus(id, status) });
});
