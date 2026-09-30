import { logger } from '@lib/logger/index.js';

import { DEFAULT_RANKING_CONFIG, resolveRankingConfig, type RankingConfig } from './ranking.config.js';

/**
 * The live ranking config.
 *
 * Held in memory and refreshed from the settings collection, because ranking
 * runs on the hottest path in the product and must not do a database read per
 * request. A change from the console takes effect within `TTL_MS`.
 *
 * The loader is injected rather than imported so this module stays free of any
 * feature: `lib` must not depend on `features`, or the dependency graph starts
 * pointing both ways.
 */

const TTL_MS = 60_000;

type Loader = () => Promise<unknown>;

let loader: Loader | null = null;
let cached: RankingConfig = DEFAULT_RANKING_CONFIG;
let expiresAt = 0;
let inFlight: Promise<RankingConfig> | null = null;

export const rankingSettings = {
  /** Wired at boot by whichever feature owns the settings store. */
  useLoader(next: Loader): void {
    loader = next;
    expiresAt = 0;
  },

  /**
   * The current config.
   *
   * Never throws and never blocks on a failure: a ranking that cannot read its
   * tuning should fall back to the shipped defaults, not refuse to rank.
   */
  async current(): Promise<RankingConfig> {
    if (loader === null) return DEFAULT_RANKING_CONFIG;
    if (Date.now() < expiresAt) return cached;
    if (inFlight !== null) return inFlight;

    inFlight = loader()
      .then((stored) => {
        cached = resolveRankingConfig(stored);
        expiresAt = Date.now() + TTL_MS;
        return cached;
      })
      .catch((error: unknown) => {
        logger.warn('ranking config unavailable, using what we have', {
          error: error instanceof Error ? error.message : 'unknown',
        });
        // Push the retry out so a broken store is not hammered per request.
        expiresAt = Date.now() + TTL_MS;
        return cached;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  },

  /** Called after a console write, so a change is visible immediately. */
  invalidate(): void {
    expiresAt = 0;
  },

  /** For tests. */
  reset(): void {
    loader = null;
    cached = DEFAULT_RANKING_CONFIG;
    expiresAt = 0;
    inFlight = null;
  },
};
