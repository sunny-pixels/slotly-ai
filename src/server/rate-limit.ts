/**
 * In-memory token bucket. Good enough for a single Node instance and local
 * development; on multi-instance/serverless deployments replace the store with
 * Redis/Upstash or a database table (see README → Known limitations).
 */
type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export type RateLimitOptions = { capacity: number; refillPerMinute: number };

export function takeToken(key: string, { capacity, refillPerMinute }: RateLimitOptions, now = Date.now()) {
  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  const elapsedMinutes = (now - bucket.updatedAt) / 60_000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedMinutes * refillPerMinute);
  bucket.updatedAt = now;

  if (buckets.size >= MAX_KEYS && !buckets.has(key)) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const retryAfterSeconds = Math.ceil(((1 - bucket.tokens) / refillPerMinute) * 60);
    return { ok: false as const, retryAfterSeconds };
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return { ok: true as const, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
