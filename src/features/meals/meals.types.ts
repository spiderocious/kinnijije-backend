import { toPublicImageView, type PublicImageView } from '@features/admin/images/admin-images.types.js';

import type { MealDocument } from './meals.model.js';
import type { MealMatch } from './meals.matcher.js';

export interface MealView {
  id: string;
  slug: string;
  name: string;
  source: 'seed' | 'ai';
  cuisines: string[];
  difficulty: string;
  cook_time_minutes: number;
  serves: number;
  what_makes_it_good: string;
  description: string;
  hero_icon: string | null;
  /**
   * The primary published image, or null.
   *
   * NULL IS THE DESIGNED DEFAULT, not an error: with no public base URL
   * configured, or no image published yet, every surface falls back to the
   * drawn `hero_icon` and the app behaves exactly as it did before imagery
   * existed.
   */
  image: PublicImageView | null;
  ingredients: { name: string; quantity: number | null; unit: string | null; optional: boolean }[];
  steps: { index: number; heading: string; description: string; est_minutes: number }[];
}

/**
 * AI cook times run short — the PRD is explicit about it. Padding at DISPLAY
 * time rather than at write time keeps the model's actual answer intact in the
 * database, so the bias stays measurable.
 */
const AI_TIME_PADDING = 1.3;

export const toMealView = (doc: MealDocument): MealView => ({
  id: doc._id,
  slug: doc.slug,
  name: doc.name,
  source: doc.source,
  cuisines: doc.cuisines,
  difficulty: doc.difficulty,
  cook_time_minutes:
    doc.source === 'ai' ? Math.round(doc.cookTimeMinutes * AI_TIME_PADDING) : doc.cookTimeMinutes,
  serves: doc.serves,
  what_makes_it_good: doc.whatMakesItGood,
  description: doc.description,
  hero_icon: doc.heroIcon,
  image: primaryImageOf(doc),
  ingredients: doc.ingredients.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    optional: i.optional,
  })),
  steps: doc.steps.map((s) => ({
    index: s.index,
    heading: s.heading,
    description: s.description,
    est_minutes: s.estMinutes,
  })),
});

/**
 * The primary image, if there is one and it is genuinely published.
 *
 * The status is re-checked here rather than trusted from the pointer: the
 * invariant is enforced in the service, and this is the last line before a
 * cook would see a rejected image.
 */
function primaryImageOf(doc: MealDocument): PublicImageView | null {
  /**
   * Both fields are read DEFENSIVELY rather than trusted.
   *
   * A document written outside Mongoose — a `mongoimport`, a migration, a
   * hand-edit in Compass — gets no schema defaults, so `images` is absent
   * rather than `[]` and `primaryImageId` is `undefined` rather than `null`.
   * `undefined === null` is false, so the old guard fell through and called
   * `.find()` on nothing, crashing every surface that presents a meal.
   *
   * This is the boundary where documents from outside the app arrive, so it is
   * the right place to be forgiving about their shape.
   */
  const primaryId = doc.primaryImageId ?? null;
  if (primaryId === null) return null;

  const images = doc.images ?? [];
  const image = images.find((i) => i._id === primaryId);
  if (image === undefined || image.status !== 'published') return null;
  return toPublicImageView(image);
}

export interface MealSuggestionView {
  meal: MealView;
  score: number;
  match_line: string;
  ingredients: MealMatch['ingredients'];
  missing: string[];
  low: string[];
  nearly_there: boolean;
  is_favourite: boolean;
}

export function toSuggestionView(match: MealMatch, isFavourite: boolean): MealSuggestionView {
  const total = match.meal.ingredients.filter((i) => !i.optional).length;
  const have = total - match.missing.length;

  return {
    meal: toMealView(match.meal),
    score: Math.round(match.score * 100) / 100,
    // The line the card shows. Phrased as a count rather than a percentage:
    // "uses 5 of your 6 things" is something a person can act on.
    match_line:
      match.missing.length === 0
        ? `You have everything`
        : `Uses ${String(have)} of ${String(total)} — needs ${String(match.missing.length)} more`,
    ingredients: match.ingredients,
    missing: match.missing,
    low: match.low,
    nearly_there: match.nearlyThere,
    is_favourite: isFavourite,
  };
}
