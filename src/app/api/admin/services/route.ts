import { requireAdmin } from "@/server/authz";
import { json, parseWith, readJson, route } from "@/server/http";
import { createService, listServicesForAdmin } from "@/server/services/catalog";
import { createServiceSchema } from "@/lib/validators";

export const GET = route(async () => {
  await requireAdmin();
  return json({ services: await listServicesForAdmin() });
});

export const POST = route(async (req) => {
  await requireAdmin();
  const input = parseWith(createServiceSchema, await readJson(req));
  return json({ service: await createService(input) }, { status: 201 });
});
