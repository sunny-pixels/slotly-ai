/** Typed fetch helper for client components. Surfaces the API's error code and message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(input: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(input, {
      ...rest,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "NETWORK_ERROR");
  }
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error?: { code: string; message: string; details?: unknown } }
    | null;
  if (!res.ok) {
    const err = body && "error" in body && body.error ? body.error : null;
    throw new ApiError(err?.message ?? `Request failed (${res.status}).`, res.status, err?.code ?? "HTTP_ERROR", err?.details);
  }
  return body as T;
}
