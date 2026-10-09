/**
 * Domain errors. Route handlers translate these into HTTP responses in
 * `src/server/http.ts`; anything else becomes a generic 500.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "The request is invalid.", details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in to continue.") {
    super(message, 401, "UNAUTHENTICATED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, 404, "NOT_FOUND");
  }
}

/** The resource changed under us — e.g. another request booked the slot first. */
export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT") {
    super(message, 409, code);
  }
}

/** The request is well-formed but violates a business rule (past slot, cancellation window…). */
export class BusinessRuleError extends AppError {
  constructor(message: string, code = "BUSINESS_RULE") {
    super(message, 422, code);
  }
}

export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests. Please wait a moment and try again.", 429, "RATE_LIMITED");
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, code = "UNAVAILABLE") {
    super(message, 503, code);
  }
}

/**
 * True when `error` is a PostgreSQL unique violation raised by the named
 * constraint/index (or on the given column). Works for Prisma known request
 * errors (P2002) surfaced through the pg driver adapter and for raw pg errors.
 */
export function isUniqueViolation(error: unknown, constraintOrColumn?: string): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; meta?: unknown; message?: string; constraint?: string };
  const isUnique = e.code === "P2002" || e.code === "23505";
  if (!isUnique) return false;
  if (!constraintOrColumn) return true;
  const haystack = JSON.stringify({ meta: e.meta ?? null, constraint: e.constraint ?? null, message: e.message ?? "" });
  return haystack.includes(constraintOrColumn);
}

/** True for PostgreSQL exclusion-constraint violations (23P01), e.g. overlapping slots. */
export function isExclusionViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const text = JSON.stringify(error, Object.getOwnPropertyNames(error));
  return text.includes("23P01") || text.includes("slots_no_overlap_per_service");
}
