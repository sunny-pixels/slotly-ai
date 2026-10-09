import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, RateLimitError, ValidationError } from "./errors";

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof AppError) {
    const headers: Record<string, string> = {};
    if (error instanceof RateLimitError) headers["Retry-After"] = String(error.retryAfterSeconds);
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
      { status: error.status, headers },
    );
  }
  // Unknown failure: log a concise server-side record, never leak internals to the client.
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error("[api] unhandled error:", message.slice(0, 500));
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Please try again." } },
    { status: 500 },
  );
}

/** Wraps a route handler so every thrown error becomes a typed JSON response. */
export function route<Ctx = unknown>(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new ValidationError("Expected a JSON request body (Content-Type: application/json).");
  }
  try {
    return await req.json();
  } catch {
    throw new ValidationError("Malformed JSON body.");
  }
}

export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError("Some fields are invalid.", z.flattenError(result.error));
  }
  return result.data;
}

export function searchParamsOf(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams.entries());
}

export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${fwd || req.headers.get("x-real-ip") || "unknown"}`;
}
