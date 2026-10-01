import { z } from 'zod';

/**
 * How a meal is scored, as data.
 *
 * Pulled out of the ranker so the numbers can be TUNED without a deploy: an
 * operator changes them in the console, and the effect is visible immediately.
 * Ranking quality is an empirical question, and a constant buried in a function
 * cannot be answered empirically.
 *
 * Every value here has a defensible default, so a missing or corrupt config
 * falls back to behaviour that is known to work rather than to zero.
 */

/**
 * What a quality tier is multiplied by.
 *
 * This is the knob that stops "boiled yam and salt" beating "yam and egg
 * sauce" for somebody holding yam and eggs. A minimal version matches almost
 * any kitchen, so on raw score alone it would win every time; the discount
 * means it only surfaces when nothing better is actually reachable.
 *
 * The gaps are wide on purpose. A 0.95 multiplier would be swamped by ordinary
 * score variation and the tiers would not separate at all.
 */
export const QualityWeightsSchema = z.object({
  full: z.number().min(0).max(2),
  simple: z.number().min(0).max(2),
  minimal: z.number().min(0).max(2),
});

export const MoodWeightsSchema = z.object({
  /** Multiplies an `easy` recipe when the cook is drained. */
  tiredEasyBonus: z.number().min(0).max(3),
  /** Multiplies an `involved` recipe when the cook is drained. Below 1. */
  tiredInvolvedPenalty: z.number().min(0).max(2),
  /** Extra weight when nothing at all is missing and they are drained. */
  tiredCompletebonus: z.number().min(0).max(3),
  /** How hard `fast` sorts on cook time. Higher means time dominates more. */
  fastTimePressure: z.number().min(0).max(3),
  /** Multiplies an `involved` recipe when they are up for it. */
  properInvolvedBonus: z.number().min(0).max(3),
  /** How much a well-stocked match reads as comforting. */
  comfortScoreWeight: z.number().min(0).max(2),
});

export const RankingConfigSchema = z.object({
  quality: QualityWeightsSchema,
  mood: MoodWeightsSchema,

  /**
   * The floor a match score is lifted to before weighting.
   *
   * Without it an empty kitchen makes every score 0, the multipliers have
   * nothing to act on, and the ordering collapses to whatever the tie-break
   * says. This keeps mood and time meaningful when nothing has been tapped.
   */
  emptyKitchenBase: z.number().min(0).max(1),
  /** How much of the final rank the match score accounts for. */
  scoreWeight: z.number().min(0).max(1),
  /**
   * How much having the meal's STAPLE counts, over and above the plain match.
   *
   * 0 reproduces the old behaviour exactly. Above that, holding the rice in a
   * rice dish outranks holding the salt in an egg dish — which is the whole
   * point: people decide around their staple, not their seasoning.
   */
  stapleWeight: z.number().min(0).max(2),
  /**
   * How hard to push a breakfast dish down outside the morning.
   *
   * A MULTIPLIER, never a filter: somebody who genuinely wants tea at 3pm
   * should still be able to reach it, and a hard cutoff would also hide
   * pap-and-akara from a night worker eating breakfast at 7pm. 1 disables it.
   */
  offHoursBreakfastPenalty: z.number().min(0).max(1),

  /** Weather nudges. A garnish: small, and skipped entirely when unavailable. */
  weather: z.object({
    hotThresholdC: z.number(),
    coolThresholdC: z.number(),
    hotHeavyPenalty: z.number().min(0).max(2),
    hotSoupyBonus: z.number().min(0).max(2),
    rainSoupyBonus: z.number().min(0).max(2),
    coolSoupyBonus: z.number().min(0).max(2),
  }),

  /**
   * Drop meals the cook has NOTHING for.
   *
   * If somebody told us what they have, a suggestion touching none of it is
   * not a suggestion: it is a shopping list with a recipe attached. Only
   * applied when ingredients were actually submitted — with an empty kitchen
   * every meal scores zero and this would leave nothing at all.
   */
  requireSomeMatch: z.boolean(),

  /**
   * Collapse variants of the same dish into one shortlist row.
   *
   * Without it, a shortlist of six can be six versions of yam, which is not a
   * choice. The best-ranked version of each dish is kept.
   */
  collapseVariants: z.boolean(),
});

export type RankingConfig = z.infer<typeof RankingConfigSchema>;
export type QualityWeights = z.infer<typeof QualityWeightsSchema>;

/**
 * The shipped defaults.
 *
 * These reproduce the behaviour the flow was built and tested against, so an
 * operator who changes nothing sees exactly what they saw before.
 */
export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  quality: {
    full: 1,
    // A pared-back version is a real answer, but the proper dish should win
    // when both are reachable.
    simple: 0.72,
    // Deliberately steep: this tier exists to be a fallback, not a competitor.
    minimal: 0.45,
  },
  mood: {
    tiredEasyBonus: 1.3,
    tiredInvolvedPenalty: 0.5,
    tiredCompletebonus: 1.25,
    fastTimePressure: 1,
    properInvolvedBonus: 1.2,
    comfortScoreWeight: 0.3,
  },
  emptyKitchenBase: 0.5,
  scoreWeight: 0.75,
  // Meaningful but not absolute: a staple match is worth roughly half again,
  // so it reorders near-ties without overriding a far better overall match.
  stapleWeight: 0.5,
  // Firm enough to clear the top of a list, soft enough to stay reachable.
  offHoursBreakfastPenalty: 0.55,
  weather: {
    hotThresholdC: 30,
    coolThresholdC: 22,
    hotHeavyPenalty: 0.85,
    hotSoupyBonus: 1.05,
    rainSoupyBonus: 1.15,
    coolSoupyBonus: 1.1,
  },
  requireSomeMatch: true,
  collapseVariants: true,
};

/**
 * A stored config, merged over the defaults.
 *
 * Partial on purpose: an operator who tunes one number must not have to
 * restate the other twenty, and a config saved before a new field existed must
 * keep working.
 */
export function resolveRankingConfig(stored: unknown): RankingConfig {
  if (stored === null || typeof stored !== 'object') return DEFAULT_RANKING_CONFIG;

  const merged = {
    ...DEFAULT_RANKING_CONFIG,
    ...(stored as Partial<RankingConfig>),
    quality: { ...DEFAULT_RANKING_CONFIG.quality, ...(stored as RankingConfig).quality },
    mood: { ...DEFAULT_RANKING_CONFIG.mood, ...(stored as RankingConfig).mood },
    weather: { ...DEFAULT_RANKING_CONFIG.weather, ...(stored as RankingConfig).weather },
  };

  const parsed = RankingConfigSchema.safeParse(merged);
  // A corrupt stored config falls back whole rather than partially: half a
  // config is harder to reason about than none.
  return parsed.success ? parsed.data : DEFAULT_RANKING_CONFIG;
}
