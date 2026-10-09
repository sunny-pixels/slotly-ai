import { z } from "zod";
import { requireAdmin } from "@/server/authz";
import { json, parseWith, readJson, route, searchParamsOf } from "@/server/http";
import { generateSlots, listSlotsForAdmin } from "@/server/services/scheduling";
import { dateKeySchema, generateSlotsSchema, idSchema } from "@/lib/validators";

const listSchema = z.object({
  serviceId: idSchema,
  from: dateKeySchema,
  days: z.coerce.number().int().min(1).max(31).default(7),
});

export const GET = route(async (req) => {
  await requireAdmin();
  const { serviceId, from, days } = parseWith(listSchema, searchParamsOf(req));
  return json({ slots: await listSlotsForAdmin(serviceId, from, days) });
});

/** Generates slots from the service's opening-hour rules (idempotent). */
export const POST = route(async (req) => {
  await requireAdmin();
  const { serviceId, from, to } = parseWith(generateSlotsSchema, await readJson(req));
  return json(await generateSlots(serviceId, from, to), { status: 201 });
});
