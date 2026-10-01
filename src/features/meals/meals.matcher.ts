import { byId, convert, resolve } from '@shared/catalogue/index.js';

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
  /**
   * Not tapped, but assumed present: salt, water, a stock cube, cooking oil.
   *
   * Shown, because a cook with no salt still needs to know the recipe wants
   * some — but never counted against the score, and never in the shopping list.
   */
  PANTRY: 'pantry',
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
  /**
   * 0–1 across required, NON-PANTRY ingredients only.
   *
   * Optional ones never drag it down, and neither do pantry staples: salt is a
   * required ingredient in 83 of 100 seeded recipes, so counting it penalised
   * every meal equally and pushed every score toward zero. Excluding them is
   * what makes the number mean "how close am I", which is what it is read as.
   */
  score: number;
  /**
   * 0–1 over the meal's STAPLE ingredients, or null when it has none.
   *
   * Separate from `score` so the ranker can weight "has the rice" above "has
   * the salt" without the matcher deciding how much that is worth — which is
   * a tuning question, and tuning lives in the ranking config.
   */
  stapleScore: number | null;
  ingredients: MatchedIngredient[];
  missing: string[];
  low: string[];
  /** Assumed-present staples this recipe needs. Never part of `missing`. */
  pantry: string[];
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

/**
 * Ingredients that stand in for each other in practice.
 *
 * The catalogue separates varieties because a shopping list and an expiry date
 * care about the difference. A RECIPE usually does not: somebody holding white
 * garri can make garri soakings, and a recipe asking for Ijebu garri is not
 * refusing theirs.
 *
 * Without this, tapping "White garri" matched NOTHING — both garri recipes
 * name `garri_ijebu` — so a meal that used only salt outranked the one thing
 * they could actually make.
 *
 * Deliberately conservative. Each group is things a Nigerian cook would swap
 * without comment, never things that merely share a shelf: every rice is rice,
 * every garri is garri, a frying oil is a frying oil. Palm oil is NOT in the
 * oil group — it is a flavour, not a medium, and swapping it changes the dish.
 */
const INTERCHANGEABLE: readonly (readonly string[])[] = [
  ['garri_white', 'garri_yellow', 'garri_ijebu', 'garri_soak'],
  ['rice_long_grain', 'rice_parboiled', 'rice_local', 'rice_basmati', 'rice_jasmine', 'brown_rice'],
  ['beans_brown', 'beans_white', 'beans_black_eyed', 'beans_iron'],
  ['groundnut_oil', 'coconut_oil', 'olive_oil'],
  ['onion_red', 'onion_white'],
  ['milk_powder', 'milk_evaporated', 'milk_fresh', 'milk_peak', 'milk_dano', 'milk_three_crowns'],
  ['stock_cube', 'chicken_stock_cube', 'seasoning_powder', 'chicken_seasoning'],
  ['tomato', 'tomato_tin_whole'],
  ['crayfish', 'crayfish_powder', 'cray_whole'],
];

/** Built once: id → every id it may be satisfied by, including itself. */
const SUBSTITUTES: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, readonly string[]>();
  for (const group of INTERCHANGEABLE) {
    for (const id of group) map.set(id, group);
  }
  return map;
})();

function findInStock(
  ingredient: MealIngredient,
  index: ReturnType<typeof indexStock>,
): StockItemDocument | undefined {
  if (ingredient.catalogueId !== null) {
    const hit = index.byCatalogue.get(ingredient.catalogueId);
    if (hit !== undefined) return hit;

    // Nothing exact: accept a variety the cook would swap without thinking.
    for (const alternative of SUBSTITUTES.get(ingredient.catalogueId) ?? []) {
      const swap = index.byCatalogue.get(alternative);
      if (swap !== undefined) return swap;
    }
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

/**
 * Is this something almost every kitchen already has?
 *
 * Read off the catalogue rather than a list kept here, so the matcher, the
 * suggestions screen and the decide flow cannot disagree about what counts as
 * a staple. An ingredient with no catalogue id falls back to its name, because
 * a recipe may spell something we never catalogued.
 */
/**
 * The groups a meal is built around, rather than seasoned with.
 *
 * Read off the catalogue rather than hardcoded per ingredient, so adding a new
 * grain or legume is automatically a staple without touching this file.
 */
const STAPLE_GROUPS = new Set(['grain', 'legume', 'flour_swallow', 'tuber', 'pasta_noodle']);

function isStaple(ingredient: MealIngredient): boolean {
  const id = ingredient.catalogueId ?? resolve(ingredient.name)?.id ?? null;
  if (id === null) return false;
  const item = byId(id);
  return item !== undefined && STAPLE_GROUPS.has(item.group);
}

function isPantry(ingredient: MealIngredient): boolean {
  if (ingredient.catalogueId !== null) return byId(ingredient.catalogueId)?.pantry === true;
  return resolve(ingredient.name)?.pantry === true;
}

export function matchMeal(meal: MealDocument, index: ReturnType<typeof indexStock>): MealMatch {
  const ingredients: MatchedIngredient[] = [];
  const missing: string[] = [];
  const low: string[] = [];
  const pantry: string[] = [];

  let required = 0;
  let satisfied = 0;

  for (const ingredient of meal.ingredients) {
    const stock = findInStock(ingredient, index);
    const isRequired = !ingredient.optional;

    // A pantry staple the cook did not tap is ASSUMED present: it is listed so
    // they know the recipe wants it, but it never counts toward the score and
    // never reaches the shopping list. Tapped explicitly, it falls through and
    // is matched like anything else.
    if (isRequired && stock === undefined && isPantry(ingredient)) {
      pantry.push(ingredient.name);
      ingredients.push({
        name: ingredient.name,
        state: INGREDIENT_STATES.PANTRY,
        needed: ingredient.quantity,
        needed_unit: ingredient.unit,
        have: null,
        have_unit: null,
      });
      continue;
    }

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
      /**
       * THEIR word for it, not the recipe's.
       *
       * A substitution means these can differ: somebody who tapped "White
       * garri" and matched a recipe asking for "Ijebu garri" should see their
       * own ingredient listed under "you have". Showing the recipe's name
       * reads as though we found something they never said they had.
       */
      name: stock.name,
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

  /**
   * How much of the meal's BACKBONE the cook actually has.
   *
   * `score` alone treats every ingredient as equal, so a dish needing eggs,
   * sausage, onion, tomato and salt scores 0.20 on salt — the same weight as
   * the rice in a rice dish. In practice that let a meal matching nothing but
   * a seasoning outrank one matching the cook's main ingredient, which is how
   * somebody holding rice was shown an egg recipe.
   *
   * Staples are what a Nigerian meal is built around and named after: the
   * grain, the legume, the swallow flour, the yam. Having one is qualitatively
   * different from having a condiment, and this is the number that says so.
   */
  const staples = meal.ingredients.filter((i) => !i.optional && isStaple(i));
  const staplesHad = staples.filter((i) => findInStock(i, index) !== undefined);
  const stapleScore = staples.length === 0 ? null : staplesHad.length / staples.length;

  return {
    meal,
    score,
    stapleScore,
    ingredients,
    missing,
    low,
    pantry,
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
