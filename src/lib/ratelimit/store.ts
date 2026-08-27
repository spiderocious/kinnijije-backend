/**
 * The contract a rate-limit backend must satisfy. It exists so the limiter
 * does not know whether it is talking to a Map or to Redis: swapping in a
 * distributed store later is one new file implementing this, and one line in
 * the factory below.
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** Tokens left in the bucket after this request. */
  remaining: number;
  /** Whole seconds until the bucket has at least one token again. */
  retryAfterSeconds: number;
  /** When the bucket returns to full, as a unix-epoch second. */
  resetAtEpochSeconds: number;
}

export interface RateLimitStore {
  /**
   * Consume one token from `key`'s bucket.
   *
   * @param capacity     bucket size — the largest burst allowed
   * @param refillPerSec tokens added per second — the sustained rate
   */
  consume(key: string, capacity: number, refillPerSec: number): Promise<RateLimitDecision>;
  reset(key: string): Promise<void>;
}
