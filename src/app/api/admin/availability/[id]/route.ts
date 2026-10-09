import { requireAdmin } from "@/server/authz";
import { json, parseWith, route } from "@/server/http";
import { deleteRule } from "@/server/services/scheduling";
import { idSchema } from "@/lib/validators";

/** Removing a rule only affects future slot generation; existing slots and bookings are kept. */
export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  await requireAdmin();
  await deleteRule(parseWith(idSchema, (await params).id));
  return json({ ok: true });
});
