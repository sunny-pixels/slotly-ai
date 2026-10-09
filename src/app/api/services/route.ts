import { json, parseWith, route, searchParamsOf } from "@/server/http";
import { listServices } from "@/server/services/catalog";
import { serviceListQuerySchema } from "@/lib/validators";

/** Public catalogue of active services, with the next bookable time for each. */
export const GET = route(async (req) => {
  const query = parseWith(serviceListQuerySchema, searchParamsOf(req));
  return json(await listServices(query));
});
