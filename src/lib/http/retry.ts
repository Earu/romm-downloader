import "server-only";

/**
 * Resilient `fetch` wrapper: retries 429 / transient 5xx responses (and network
 * errors), honouring a server's `Retry-After` when present and otherwise backing
 * off exponentially with full jitter. Built for scraping/downloading from sources
 * that rate-limit aggressively (Vimm's Lair).
 */

export interface FetchRetryOptions {
  /** Total attempts including the first. Default 4. */
  attempts?: number;
  /** Base for exponential backoff, in ms. Default 1000. */
  baseDelayMs?: number;
  /** Per-wait cap, in ms — also caps a large `Retry-After`. Default 30_000. */
  maxDelayMs?: number;
  /** Statuses worth retrying. Default {429, 500, 502, 503, 504}. */
  retryStatuses?: Set<number>;
  /** Tag for the `[<label>]` console warning emitted before each wait. */
  label?: string;
}

const DEFAULT_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date) into ms, clamped to
 * [0, maxMs]. Returns null when absent/unparseable so the caller falls back to
 * exponential backoff.
 */
export function parseRetryAfter(header: string | null, maxMs: number): number | null {
  if (!header) return null;
  const secs = Number(header.trim());
  if (Number.isFinite(secs)) return Math.min(maxMs, Math.max(0, secs * 1000));
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.min(maxMs, Math.max(0, date - Date.now()));
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const retryStatuses = opts.retryStatuses ?? DEFAULT_RETRY_STATUSES;
  const tag = opts.label ? `[${opts.label}] ` : "";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const last = attempt === attempts;

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Network/abort error — retry with backoff unless we're out of attempts.
      if (last) throw err;
      const wait = backoff(baseDelayMs, maxDelayMs, attempt);
      console.warn(`${tag}fetch error (attempt ${attempt}/${attempts}), retrying in ${wait}ms: ${err}`);
      await sleep(wait);
      continue;
    }

    if (res.ok || !retryStatuses.has(res.status) || last) return res;

    // Retryable status with attempts left: wait what the server asks for, or back off.
    const wait =
      parseRetryAfter(res.headers.get("retry-after"), maxDelayMs) ??
      backoff(baseDelayMs, maxDelayMs, attempt);
    console.warn(`${tag}HTTP ${res.status} (attempt ${attempt}/${attempts}), retrying in ${wait}ms`);
    await res.body?.cancel().catch(() => {}); // free the socket before retrying
    await sleep(wait);
  }

  // Unreachable: the final attempt always returns or throws above.
  throw new Error("fetchWithRetry: exhausted attempts");
}

/** Exponential backoff with full jitter, capped at maxMs. `attempt` is 1-based. */
function backoff(baseMs: number, maxMs: number, attempt: number): number {
  const ceil = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(Math.random() * ceil);
}
