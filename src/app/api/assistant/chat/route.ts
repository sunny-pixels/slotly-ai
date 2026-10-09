import { getCurrentUser } from "@/server/authz";
import { RateLimitError } from "@/server/errors";
import { clientKey, json, parseWith, readJson, route } from "@/server/http";
import { takeToken } from "@/server/rate-limit";
import { handleChat, toPublicReply } from "@/server/assistant/orchestrator";
import { chatRequestSchema } from "@/lib/validators";

export const maxDuration = 60;

/**
 * Conversational assistant. Works for guests (knowledge + availability) and
 * signed-in customers (their own bookings). It never mutates data: booking and
 * cancellation proposals are confirmed by the user through the normal APIs.
 */
export const POST = route(async (req) => {
  const actor = await getCurrentUser();
  const limit = takeToken(`chat:${clientKey(req, actor?.id)}`, { capacity: 20, refillPerMinute: 10 });
  if (!limit.ok) throw new RateLimitError(limit.retryAfterSeconds);

  const { message, history } = parseWith(chatRequestSchema, await readJson(req));
  const reply = await handleChat(actor, message, history);
  return json({ reply: toPublicReply(reply) });
});
