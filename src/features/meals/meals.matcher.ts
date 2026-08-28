import { convert } from '@shared/catalogue/index.js';

import type { MealDocument, MealIngredient } from './meals.model.js';
import type { StockItemDocument } from '@features/stock/stock.model.js';

/**
 * How a meal is matched against a kitchen.
 *
 * Entirely deterministic — no model involved. That is deliberate: the answer is
 * explainable ("you have 5 of 7 things"), free, instant, and identical every
 * time. AI suggestions are a separate path for when a person wants a
 * conversation instead.
 */

export const INGREDIENT_STATES = {
  /** In the kitchen, and enough of it. */
  ENOUGH: 'enough',
  /** In the kitchen, but the amount looks short. */
  LOW: 'low',
  /** Not in the kitchen at all. */
  MISSING: 'missing',
  /** Not in the kitchen, but the meal works without it. */
  OPTIONAL_MISSING: 'optional_missing',
} as const;

export type IngredientState = (typeof INGREDIENT_STATES)[keyof typeof INGREDIENT_STATES];

export interface MatchedIngredient {
  name: string;
  state: IngredientState;
  needed: number | null;
  needed_unit: string | null;
  have: number | null;
  have_unit: string | null;
}

export interface MealMatch {
  meal: MealDocument;
  /** 0–1 across required ingredients only. Optional ones never drag it down. */
  score: number;
  ingredients: MatchedIngredient[];
  missing: string[];
  low: string[];
  /** True when one or two things stand between the cook and this meal. */
  nearlyThere: boolean;
}

/**
 * Indexes a kitchen for matching.
 *
 * Keyed by catalogue id AND by lowercased name: a custom item has no catalogue
 * id, and a seeded meal may name something we never catalogued. Matching on
 * only one of the two silently misses half the cases.
 */
export function indexStock(stock: readonly StockItemDocument[]): {
  byCatalogue: Map<string, StockItemDocument>;
  byName: Map<string, StockItemDocument>;
} {
  const byCatalogue = new Map<string, StockItemDocument>();
  const byName = new Map<string, StockItemDocument>();

  for (const item of stock) {
    // Zero quantity is NOT "have it". A rice row at 0 must read as missing, or
    // the app tells someone to cook jollof with no rice.
    if (item.quantity <= 0) continue;
    if (item.catalogueId !== null) byCatalogue.set(item.catalogueId, item);
    byName.set(item.name.toLowerCase(), item);
  }

  return { byCatalogue, byName };
}

function findInStock(
  ingredient: MealIngredient,
  index: ReturnType<typeof indexStock>,
): StockItemDocument | undefined {
  if (ingredient.catalogueId !== null) {
    const hit = index.byCatalogue.get(ingredient.catalogueId);
    if (hit !== undefined) return hit;
  }
  return index.byName.get(ingredient.name.toLowerCase());
}

/**
 * Whether there is enough of something.
 *
 * Deliberately generous. Quantities in a home kitchen are approximate on both
 * sides — the recipe says "3 cups", the cook has "some rice" — so this only
 * calls something LOW when the shortfall is unmistakable. Crying short on a
 * near-miss would make every meal look uncookable.
 */
function hasEnough(need: MealIngredient, have: StockItemDocument): boolean {
  if (need.quantity === null || need.unit === null) return true;

  if (need.unit === have.unit) return have.quantity >= need.quantity * 0.75;

  const converted = convert(need.quantity, need.unit, have.unit);
  // Units that cannot convert (a "bag", a "basket") are treated as enough —
  // we genuinely do not know, and guessing short is the more annoying error.
  if (!converted.ok || converted.value === null) return true;

  return have.quantity >= converted.value * 0.75;
}

export function matchMeal(meal: MealDocument, index: ReturnType<typeof indexStock>): MealMatch {
  const ingredients: MatchedIngredient[] = [];
  const missing: string[] = [];
  const low: string[] = [];

  let required = 0;
  let satisfied = 0;

  for (const ingredient of meal.ingredients) {
    const stock = findInStock(ingredient, index);
    const isRequired = !ingredient.optional;
    if (isRequired) required += 1;

    if (stock === undefined) {
      const state = isRequired ? INGREDIENT_STATES.MISSING : INGREDIENT_STATES.OPTIONAL_MISSING;
      if (isRequired) missing.push(ingredient.name);
      ingredients.push({
        name: ingredient.name,
        state,
        needed: ingredient.quantity,
        needed_unit: ingredient.unit,
        have: null,
        have_unit: null,
      });
      continue;
    }

    const enough = hasEnough(ingredient, stock);
    if (isRequired && enough) satisfied += 1;
    // A LOW ingredient counts as half: the cook probably can cook it, but they
    // should know before they start.
    if (isRequired && !enough) {
      satisfied += 0.5;
      low.push(ingredient.name);
    }

    ingredients.push({
      name: ingredient.name,
      state: enough ? INGREDIENT_STATES.ENOUGH : INGREDIENT_STATES.LOW,
      needed: ingredient.quantity,
      needed_unit: ingredient.unit,
      have: stock.quantity,
      have_unit: stock.unit,
    });
  }

  // A meal with no required ingredients is fully makeable rather than a
  // divide-by-zero.
  const score = required === 0 ? 1 : satisfied / required;

  return {
    meal,
    score,
    ingredients,
    missing,
    low,
    nearlyThere: missing.length > 0 && missing.length <= 2,
  };
}

/** The five closest, best first. */
export function rankMeals(
  meals: readonly MealDocument[],
  stock: readonly StockItemDocument[],
  limit = 5,
): MealMatch[] {
  const index = indexStock(stock);

  return meals
    .map((meal) => matchMeal(meal, index))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Same score: fewer missing things wins, then the quicker cook.
      if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
      return a.meal.cookTimeMinutes - b.meal.cookTimeMinutes;
    })
    .slice(0, limit);
}

/** "Could make" — everything required is present. */
export const MAKEABLE_THRESHOLD = 1;

export function countMakeable(
  meals: readonly MealDocument[],
  stock: readonly StockItemDocument[],
): number {
  const index = indexStock(stock);
  return meals.filter((meal) => matchMeal(meal, index).score >= MAKEABLE_THRESHOLD).length;
}
