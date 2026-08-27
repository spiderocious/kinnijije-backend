import { MemoryRateLimitStore } from './memory-store.js';
import type { RateLimitStore } from './store.js';

/**
 * The single rate-limit backend for the process. Swapping to Redis is a change
 * here and nowhere else, because every limiter goes through RateLimitStore.
 */
export const rateLimitStore: RateLimitStore = new MemoryRateLimitStore();

export const stopRateLimitStore = (): void => {
  if (rateLimitStore instanceof MemoryRateLimitStore) rateLimitStore.stop();
};

export { RATE_LIMITS, type RateLimitPolicy } from './limits.js';
export type { RateLimitDecision, RateLimitStore } from './store.js';
