/**
 * Tiny in-memory fixed-window rate limiter. Enough for a single self-hosted
 * instance (no external store); resets per window. Used to blunt brute-force /
 * credential-stuffing against the public login endpoint.
 */
interface Bucket {
  count: number;
  resetAt: number; // epoch ms when the window rolls over
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (for a Retry-After header). */
  retryAfter: number;
}

/**
 * Record a hit for `key` and report whether it's within `limit` per `windowMs`.
 * @param now epoch ms (injectable for tests; defaults to Date.now()).
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * Best-effort client IP from the proxy chain. Only meaningful behind a trusted
 * reverse proxy that sets `x-forwarded-for`; falls back to a constant so the app
 * still rate-limits (globally) when the header is absent.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
