import { z } from "zod";
import { requireAdmin } from "@/server/authz";
import { json, parseWith, readJson, route, searchParamsOf } from "@/server/http";
import { createRule, listRules } from "@/server/services/scheduling";
import { availabilityRuleSchema, idSchema } from "@/lib/validators";

/** Weekly opening-hour rules that slot generation expands into concrete slots. */
export const GET = route(async (req) => {
  await requireAdmin();
  const { serviceId } = parseWith(z.object({ serviceId: idSchema.optional() }), searchParamsOf(req));
  return json({ rules: await listRules(serviceId) });
});

export const POST = route(async (req) => {
  await requireAdmin();
  const input = parseWith(availabilityRuleSchema, await readJson(req));
  return json({ rule: await createRule(input) }, { status: 201 });
});
