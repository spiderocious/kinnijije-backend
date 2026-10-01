import { indexStock, matchMeal, INGREDIENT_STATES } from '@features/meals/meals.matcher.js';
import { qualityOf, type MealDocument } from '@features/meals/meals.model.js';
import { DEFAULT_RANKING_CONFIG, type RankingConfig } from '@lib/ranking/index.js';
import type { StockItemDocument } from '@features/stock/stock.model.js';
import { resolve } from '@shared/catalogue/index.js';

import {
  MOODS,
  WEIGHTS,
  type DecideCandidate,
  type DecideInput,
  type Mood,
  type TimeBudget,
  type Weight,
} from './decide.types.js';

/**
 * How a meal is chosen for a guest.
 *
 * Entirely deterministic — no model is involved anywhere in this file. The
 * model's only job, later, is to write one sentence ABOUT the winner this
 * picks. That split is what makes a hallucinated meal structurally impossible
 * rather than merely unlikely.
 */

/**
 * How many candidates the shortlist carries.
 *
 * Ten, raised from six. The deck is swipeable and "not feeling it" re-ranks
 * locally over this pool, so a bigger shortlist costs nothing extra — no
 * additional model call, no additional query — and gives somebody who refuses
 * three suggestions somewhere left to go.
 */
export const POOL_SIZE = 10;

/**
 * Turns tapped item names into the stock rows the matcher expects.
 *
 * A guest has no stock documents, so these are synthetic. `quantity` is 1 and
 * NOT 0: `indexStock` drops anything at or below zero, which would make every
 * item the person tapped read back as missing — the exact opposite of what
 * they told us.
 *
 * The unit is null on purpose. `hasEnough` treats a null unit as "enough",
 * which is right here: tapping "rice" asserts presence, never quantity. No
 * ingredient should ever come back LOW on the anonymous path.
 */
export function adaptKitchenToStock(items: readonly string[]): StockItemDocument[] {
  const seen = new Set<string>();
  const rows: StockItemDocument[] = [];

  for (const raw of items) {
    const name = raw.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const hit = resolve(name);
    rows.push({
      name,
      catalogueId: hit?.id ?? null,
      quantity: 1,
      unit: null,
      // The matcher reads only the four fields above. This is deliberately a
      // structural cast rather than a real document: constructing a Mongoose
      // document here would mean a database round-trip for data that is never
      // persisted.
    } as unknown as StockItemDocument);
  }

  return rows;
}

/**
 * The cook-time ceiling.
 *
 * An impatient mood tightens the budget the person chose, but only DOWN TO A
 * FLOOR. Clamping `fast` to a flat 25 minutes left exactly one meal in the
 * whole catalogue, so somebody who asked for something solid in forty minutes
 * was handed Indomie noodles: the weight filter found nothing at 25, fell back
 * to the unfiltered pool, and offered the only survivor.
 *
 * A mood is a PREFERENCE for quicker, not a hard cap that overrides the number
 * the person explicitly picked. So it shortens the budget by a proportion and
 * never goes below `MIN_CEILING`, which is low enough to be meaningfully quick
 * and high enough that real recipes exist under it.
 *
 * Mood still decides the ORDER — see `moodMultiplier`, where `fast` sorts hard
 * on cook time. That is where impatience belongs: in the ranking, not in a
 * filter that can empty the catalogue.
 */
const MIN_CEILING = 35;

export function ceilingFor(mood: Mood, minutes: TimeBudget): number {
  const shortened =
    mood === MOODS.TIRED
      ? Math.round(minutes * 0.8)
      : mood === MOODS.FAST
        ? Math.round(minutes * 0.7)
        : minutes;

  // The floor must never RAISE the budget above what the person chose: asking
  // for 15 minutes and being offered a 35-minute cook is the same failure in
  // the opposite direction.
  return Math.min(minutes, Math.max(MIN_CEILING, shortened));
}

/**
 * Which meals a weight preference admits.
 *
 * Read off the meal's own name, cuisines, description AND INGREDIENTS, because
 * the catalogue has no explicit "weight" field and inventing one would mean
 * re-tagging 340 recipes before any of this could ship.
 *
 * The ingredients are the fix for a real bug: "Nigerian Tea" is made of Milo
 * and milk, and its name, cuisine and description contain none of the `light`
 * terms — so somebody who said they had Milo was handed a pap recipe they had
 * nothing for, because the one meal that used it had already been filtered out
 * a stage earlier. Fifteen of thirty-three breakfast meals failed the same way.
 *
 * This is still keyword matching over free text and it is still fragile: a
 * recipe that merely mentions egg becomes `light`. It is a stopgap until meals
 * carry a real weight tag, and it is deliberately GENEROUS, because this filter
 * stands down entirely when it would empty the pool — a false positive costs a
 * slightly odd suggestion, a false negative costs the only meal that fit.
 */
const WEIGHT_TERMS: Readonly<Record<Weight, readonly string[]>> = {
  [WEIGHTS.SOLID]: ['rice', 'yam', 'plantain', 'beans', 'potato', 'spaghetti', 'pasta', 'bread'],
  /**
   * Extended for breakfast, which the original list had no vocabulary for.
   *
   * A cup of tea, a bowl of oats and a plate of cornflakes are the lightest
   * things in the catalogue, and none of them contained any of the first eight
   * terms — so "light" silently excluded every drink and cereal we had. That
   * is what left somebody holding Milo with nothing to cook.
   */
  [WEIGHTS.LIGHT]: [
    'salad', 'vegetable', 'soup', 'moi', 'akara', 'pap', 'fruit', 'egg',
    'tea', 'coffee', 'milo', 'bournvita', 'oats', 'cornflakes', 'custard',
    'yoghurt', 'milk', 'smoothie', 'juice', 'banana', 'cereal', 'toast',
  ],
  [WEIGHTS.SOUPY]: ['soup', 'stew', 'pepper', 'broth', 'egusi', 'ogbono', 'efo', 'okra', 'banga'],
  [WEIGHTS.SWALLOW]: ['amala', 'eba', 'fufu', 'pounded', 'semo', 'swallow', 'garri', 'starch', 'tuwo'],
  [WEIGHTS.RICE]: ['rice', 'jollof', 'fried rice', 'ofada', 'tuwo'],
  [WEIGHTS.STREET]: ['suya', 'akara', 'puff', 'boli', 'roast', 'shawarma', 'gala', 'dodo'],
};

export function matchesWeight(meal: MealDocument, weight: Weight): boolean {
  const ingredients = meal.ingredients.map((i) => i.name).join(' ');
  const haystack =
    `${meal.name} ${meal.cuisines.join(' ')} ${meal.description} ${ingredients}`.toLowerCase();
  return WEIGHT_TERMS[weight].some((term) => haystack.includes(term));
}

/**
 * The weather nudge. A small multiplier, never a filter.
 *
 * Weather is a garnish: when the lookup fails we skip it silently rather than
 * failing the decision, so `null` here is an ordinary outcome.
 */
export interface WeatherHint {
  /** Degrees celsius. */
  temperature: number | null;
  /** True when it is actively raining. */
  raining: boolean;
}

/**
 * Whether a dish is breakfast food.
 *
 * Read off the name and description, like the weight filter — meals carry no
 * meal-time tag and adding one would mean re-tagging 413 recipes before any of
 * this could ship. Deliberately NARROW: these are things nobody eats for
 * dinner, so a false positive is costly and a miss merely leaves today's
 * behaviour.
 */
const BREAKFAST_TERMS = [
  'tea', 'coffee', 'milo', 'bournvita', 'pap', 'ogi', 'akamu', 'custard',
  'oats', 'cornflakes', 'cereal',
];

export function isBreakfast(meal: MealDocument): boolean {
  const name = meal.name.toLowerCase();
  // Name only, not the description: "serve with tea" in a method would
  // otherwise turn a stew into breakfast.
  return BREAKFAST_TERMS.some((term) => new RegExp(`\\b${term}\\b`).test(name));
}

/**
 * The hours a Nigerian breakfast is actually eaten.
 *
 * Generous at both ends. Somebody eating pap at ten in the morning is having
 * breakfast; somebody drinking Milo at three in the afternoon is doing
 * something else, and the suggestion should reflect that without forbidding it.
 */
const BREAKFAST_UNTIL_HOUR = 11;

/**
 * A soft push DOWN for breakfast food outside the morning.
 *
 * Never a filter. A night worker eating pap at seven in the evening is a real
 * person, and so is somebody who just wants tea — both should still be able to
 * reach it, two swipes down rather than first.
 *
 * `hour` is passed in rather than read from the clock here, so this stays a
 * pure function and the caller decides whose timezone matters.
 */
export function timeOfDayMultiplier(
  meal: MealDocument,
  hour: number | null,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): number {
  if (hour === null) return 1;
  if (hour < BREAKFAST_UNTIL_HOUR) return 1;
  return isBreakfast(meal) ? config.offHoursBreakfastPenalty : 1;
}

export function weatherMultiplier(
  meal: MealDocument,
  hint: WeatherHint | null,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
): number {
  if (hint === null) return 1;

  const w = config.weather;
  const name = `${meal.name} ${meal.description}`.toLowerCase();
  const soupy = ['soup', 'pepper soup', 'broth'].some((t) => name.includes(t));
  const heavy = ['amala', 'eba', 'fufu', 'pounded', 'swallow'].some((t) => name.includes(t));

  let multiplier = 1;

  if (hint.temperature !== null && hint.temperature > w.hotThresholdC) {
    // Hot and humid: a heavy swallow is a harder sell, something light is easier.
    if (heavy) multiplier *= w.hotHeavyPenalty;
    if (soupy) multiplier *= w.hotSoupyBonus;
  }
  if (hint.raining && soupy) multiplier *= w.rainSoupyBonus;
  if (hint.temperature !== null && hint.temperature < w.coolThresholdC && soupy) {
    multiplier *= w.coolSoupyBonus;
  }

  return multiplier;
}

/** The mood's own weighting, applied to an already-matched candidate. */
function moodMultiplier(
  mood: Mood,
  meal: MealDocument,
  score: number,
  missing: number,
  config: RankingConfig,
): number {
  const m = config.mood;

  switch (mood) {
    case MOODS.TIRED:
      // Fewest missing things wins outright; an involved recipe is punished hard.
      return (
        (meal.difficulty === 'easy'
          ? m.tiredEasyBonus
          : meal.difficulty === 'medium'
            ? 1
            : m.tiredInvolvedPenalty) * (missing === 0 ? m.tiredCompletebonus : 1)
      );
    case MOODS.FAST:
      // Time dominates: a 20-minute meal beats a better-matched 60-minute one.
      return 1 + Math.max(0, ((60 - meal.cookTimeMinutes) / 60) * m.fastTimePressure);
    case MOODS.PROPER:
      // An involved cook is welcome, and a market trip is acceptable.
      return meal.difficulty === 'involved' ? m.properInvolvedBonus : 1;
    case MOODS.COMFORT:
      // The familiar beats the novel; a well-stocked match reads as comforting.
      return 1 + score * m.comfortScoreWeight;
    case MOODS.SURPRISE:
      /**
       * Neutral BY DESIGN, and the only mood that is.
       *
       * "I don't even know" is a statement about the person, not the food:
       * it says nothing about time, effort or comfort. Multiplying by one
       * leaves the ranking entirely to their other answers and the match
       * score, which is the honest reading. Any bias here would be us
       * inventing a preference they explicitly declined to express.
       */
      return 1;
  }
}

export interface RankOptions {
  weather?: WeatherHint | null | undefined;
  /**
   * Local hour, 0–23, for pushing breakfast food down in the afternoon.
   *
   * Passed in rather than read from the clock so this stays deterministic and
   * testable, and so the caller decides whose timezone counts. Null disables
   * the nudge entirely.
   */
  hour?: number | null | undefined;
  limit?: number | undefined;
  /** Tunable weights. Defaults to the shipped config when absent. */
  config?: RankingConfig | undefined;
  /**
   * Order mode only: meal names (trimmed, lowercased) that a cached Chowdeck
   * search already found restaurants for in the chosen place. Read from our
   * cache, never fetched for this — the decision must not wait on Chowdeck.
   */
  orderable?: ReadonlySet<string> | undefined;
}

/**
 * The nudge toward a dish we already know can be ordered nearby.
 *
 * A nudge, not a filter: the cache only knows what somebody has asked about,
 * so a dish missing from it is unknown rather than unavailable.
 */
export const ORDERABLE_BOOST = 1.5;

/**
 * In order mode, only the proper dish.
 *
 * `simple` and `minimal` are versions for a kitchen with little in it. A
 * restaurant sells egusi soup, not "egusi with what you have" — and a minimal
 * version would win on reachability alone if it were left in, which is
 * meaningless when nobody is cooking.
 */
const orderableQuality = (meal: MealDocument): boolean => qualityOf(meal) === 'full';

/**
 * Keeps the best-ranked version of each dish.
 *
 * Without it a shortlist of six can be six versions of yam, which is not a
 * choice. Variants are grouped by `variantOf`, falling back to the meal's own
 * slug so a full dish and its variants collapse together.
 */
function collapseVariants(candidates: DecideCandidate[]): DecideCandidate[] {
  const best = new Map<string, DecideCandidate>();

  for (const candidate of candidates) {
    const family = candidate.meal.variantOf ?? candidate.meal.slug;
    const existing = best.get(family);
    if (existing === undefined || candidate.rank > existing.rank) best.set(family, candidate);
  }

  return [...best.values()];
}

/**
 * Filter → match → rank, in that order.
 *
 * Returns up to `limit` candidates, best first. An empty result is a real
 * answer ("nothing fits"), not an error — the caller decides what to say.
 */
export function rankCandidates(
  meals: readonly MealDocument[],
  input: DecideInput,
  options: RankOptions = {},
): DecideCandidate[] {
  const limit = options.limit ?? POOL_SIZE;
  const weather = options.weather ?? null;
  const hour = options.hour ?? null;
  const config = options.config ?? DEFAULT_RANKING_CONFIG;
  const ordering = input.mode === 'order';
  // Nobody is cooking, so the clock the person picked says nothing about the dish.
  const ceiling = ordering ? Number.POSITIVE_INFINITY : ceilingFor(input.mood, input.minutes);
  const refused = new Set(input.rejected);
  const orderable = options.orderable ?? new Set<string>();

  // ── Stage 1 · filter ──────────────────────────────────────────────────
  const published = meals.filter((meal) => {
    if (meal.status !== 'published') return false;
    if (refused.has(meal._id)) return false;
    if (meal.cookTimeMinutes > ceiling) return false;
    return true;
  });

  // The quality rule narrows, but never to nothing — same stance as weight below.
  const fullOnly = ordering ? published.filter(orderableQuality) : published;
  const eligible = fullOnly.length > 0 ? fullOnly : published;

  // The weight preference narrows, but never to nothing: if no meal carries
  // the tag, an unfiltered ranking is a better answer than an empty screen.
  const byWeight = eligible.filter((meal) => matchesWeight(meal, input.weight));
  const pool = byWeight.length > 0 ? byWeight : eligible;

  // ── Stage 2 · match ───────────────────────────────────────────────────
  const stock = adaptKitchenToStock(input.kitchenItems);
  const index = indexStock(stock);

  // ── Stage 3 · rank ────────────────────────────────────────────────────
  const candidates: DecideCandidate[] = pool.map((meal) => {
    const matched = matchMeal(meal, index);
    const have = matched.ingredients
      .filter((i) => i.state === INGREDIENT_STATES.ENOUGH || i.state === INGREDIENT_STATES.LOW)
      .map((i) => i.name);

    // An empty kitchen makes every score 0, which would leave the sort with
    // nothing to work with — so mood and time decide it instead.
    /**
     * The staple bonus.
     *
     * A plain `satisfied / required` treats the rice in a rice dish exactly
     * like the salt in an egg dish, so somebody holding rice and salt was shown
     * "Nigerian Breakfast Eggs" (0.20, matched on salt alone) above "Coconut
     * Rice" (0.50, matched on the rice). Weighting the backbone fixes the
     * ordering without overriding a genuinely better overall match.
     *
     * Null staple score means the meal has no staple at all — a soup, a drink —
     * and those are left exactly as they were rather than penalised for it.
     */
    const stapleBonus =
      matched.stapleScore === null ? 1 : 1 + matched.stapleScore * config.stapleWeight;

    const base =
      input.kitchenItems.length === 0
        ? config.emptyKitchenBase
        : (1 - config.scoreWeight + matched.score * config.scoreWeight) * stapleBonus;

    /**
     * Order mode drops the mood weighting: every mood rule is about the COOK
     * (effort, cook time, what is already in the kitchen), and none of that
     * applies to a plate somebody else makes. Mood still steered the weight
     * filter above, and the model still reads it.
     */
    const mood = ordering
      ? 1
      : moodMultiplier(input.mood, meal, matched.score, matched.missing.length, config);
    const nearby = ordering && orderable.has(meal.name.trim().toLowerCase()) ? ORDERABLE_BOOST : 1;

    /**
     * The discount that stops a bare version winning on reachability alone.
     *
     * "Boiled yam and salt" matches almost any kitchen, so on raw score it
     * would beat "yam and egg sauce" every time for somebody holding both yam
     * and eggs. Quality is what makes the proper dish win when it is actually
     * reachable, and lets the bare one surface only when nothing else is.
     */
    const rank =
      base *
      config.quality[qualityOf(meal)] *
      mood *
      weatherMultiplier(meal, weather, config) *
      timeOfDayMultiplier(meal, hour, config) *
      nearby;

    return {
      meal,
      score: matched.score,
      rank,
      ingredients: matched.ingredients,
      have,
      missing: matched.missing,
      low: matched.low,
      pantry: matched.pantry,
    };
  });

  /**
   * A suggestion the cook has nothing for is a shopping list, not a decision.
   *
   * Only applied when they actually told us something: with an empty kitchen
   * every score is zero, and filtering on that would leave nothing to show.
   * The filter also stands down if it would empty the shortlist entirely —
   * an honest "here is the closest thing" beats a blank screen.
   */
  const toldUsSomething = input.kitchenItems.length > 0;
  const withSomeMatch =
    config.requireSomeMatch && toldUsSomething
      ? candidates.filter((c) => c.have.length > 0)
      : candidates;

  /**
   * When somebody told us what they have and NOTHING uses any of it, that is
   * an empty result — not a reason to serve the pool we just rejected.
   *
   * This used to fall back to `candidates` unconditionally, which is how a
   * person who said "I have Milo" was handed Quick Instant Pap with every
   * single ingredient missing, under a confident sentence about how well it
   * suited them. An honest "nothing matched" lets the screen offer to widen
   * the time or add to the kitchen; a confident wrong answer offers nothing
   * and costs trust.
   *
   * The fallback still applies when they told us nothing: with an empty
   * kitchen every score is zero by definition, and "here is the closest
   * thing" is then the correct reading rather than a failure.
   */
  if (withSomeMatch.length === 0 && config.requireSomeMatch && toldUsSomething) {
    return [];
  }

  const usable = withSomeMatch.length > 0 ? withSomeMatch : candidates;

  const shortlist = config.collapseVariants ? collapseVariants(usable) : usable;

  return shortlist
    .sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      // Deterministic tie-breaks, so the same draft always yields the same
      // order — a shuffled answer on refresh reads as the app guessing.
      if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
      if (a.meal.cookTimeMinutes !== b.meal.cookTimeMinutes) {
        return a.meal.cookTimeMinutes - b.meal.cookTimeMinutes;
      }
      return a.meal._id.localeCompare(b.meal._id);
    })
    .slice(0, limit);
}
