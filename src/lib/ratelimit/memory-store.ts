import type { RateLimitDecision, RateLimitStore } from './store.js';

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * Token bucket, in process memory.
 *
 * Token bucket rather than fixed window deliberately: a fixed window lets a
 * client spend its whole quota at the end of one window and again at the start
 * of the next, which is a burst of twice the intended rate at the boundary.
 *
 * Scope caveat, deliberately accepted: counters live in this process, so with
 * more than one instance each enforces the limit separately. For a single
 * instance this is exact and costs no network round-trip on the hot path.
 * Swap in a Redis store implementing RateLimitStore when horizontal scaling
 * arrives — no callsite changes.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(sweepIntervalMs = 60_000) {
    // Without a sweep, a bucket is created per distinct key and never freed —
    // an unbounded Map keyed by client IP is a slow memory leak.
    this.sweeper = setInterval(() => {
      this.sweep();
    }, sweepIntervalMs);
    // Do not hold the event loop open on account of the sweeper.
    this.sweeper.unref();
  }

  consume(key: string, capacity: number, refillPerSec: number): Promise<RateLimitDecision> {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: capacity, lastRefillMs: now };

    const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000);
    const tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);

    const allowed = tokens >= 1;
    const remaining = allowed ? tokens - 1 : tokens;

    this.buckets.set(key, { tokens: remaining, lastRefillMs: now });

    // Time until one whole token exists again.
    const deficit = allowed ? 0 : 1 - remaining;
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil(deficit / refillPerSec));
    const secondsToFull = (capacity - remaining) / refillPerSec;

    return Promise.resolve({
      allowed,
      remaining: Math.floor(remaining),
      retryAfterSeconds,
      resetAtEpochSeconds: Math.ceil(now / 1000 + secondsToFull),
    });
  }

  reset(key: string): Promise<void> {
    this.buckets.delete(key);
    return Promise.resolve();
  }

  /** Drops buckets that have refilled to capacity — they carry no state worth keeping. */
  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      // 15 minutes idle is longer than any window configured in limits.ts.
      if (now - bucket.lastRefillMs > 15 * 60_000) this.buckets.delete(key);
    }
  }

  /** For a graceful shutdown, so the interval does not outlive the server. */
  stop(): void {
    clearInterval(this.sweeper);
  }
}
