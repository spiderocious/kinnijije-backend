import { aiService, GeneratedRecipeSchema, PROMPT_IDS } from '@lib/ai/index.js';
import { isoOrNull } from '@lib/dates.js';
import { resolve as resolveIngredient } from '@shared/catalogue/lookup.js';
import { notifyStockDropped } from '@features/notifications/notifications.jobs.js';
import { StockItemModel } from '@features/stock/stock.model.js';
import { stockService } from '@features/stock/stock.service.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';
import { UserModel } from '@features/users/users.model.js';

import { countMakeable, rankMeals } from './meals.matcher.js';
import { CookedMealModel, FavouriteModel, MealModel, type MealDocument } from './meals.model.js';
import { toMealView, toSuggestionView, type MealSuggestionView, type MealView } from './meals.types.js';

export class MealsService {
  private static instance: MealsService | undefined;

  static getInstance(): MealsService {
    MealsService.instance ??= new MealsService();
    return MealsService.instance;
  }

  /**
   * Published meals, filtered by the cook's stated cuisines.
   *
   * The cuisine filter is HARD, per the PRD: someone who picked only Asian and
   * Mediterranean must never be shown egusi. An empty preference means no
   * filter rather than no results.
   */
  private async candidateMeals(ownerId: string): Promise<MealDocument[]> {
    const user = await UserModel.findById(ownerId).exec();
    const cuisines = user?.prefs?.cuisines ?? [];
    const difficulty = user?.prefs?.difficulty ?? 'anything';

    const query: Record<string, unknown> = { status: 'published' };
    if (cuisines.length > 0) query['cuisines'] = { $in: cuisines };
    if (difficulty === 'easy') query['difficulty'] = 'easy';
    else if (difficulty === 'medium') query['difficulty'] = { $in: ['easy', 'medium'] };

    return MealModel.find(query).exec();
  }

  async suggest(ownerId: string, limit = 5): Promise<ServiceResult<MealSuggestionView[]>> {
    const [meals, stock, favourites] = await Promise.all([
      this.candidateMeals(ownerId),
      StockItemModel.find({ ownerId }).exec(),
      FavouriteModel.find({ ownerId }).select('mealId').exec(),
    ]);

    if (meals.length === 0) {
      // Honest empty rather than an error: no seeded meals matching their
      // preferences is a real, recoverable state.
      return ok([]);
    }

    const favouriteIds = new Set(favourites.map((f) => f.mealId));
    const ranked = rankMeals(meals, stock, limit);

    return ok(ranked.map((match) => toSuggestionView(match, favouriteIds.has(match.meal._id))));
  }

  /** Feeds the dashboard's "could make" stat. */
  async countMakeable(ownerId: string): Promise<number> {
    try {
      const [meals, stock] = await Promise.all([
        this.candidateMeals(ownerId),
        StockItemModel.find({ ownerId }).exec(),
      ]);
      return countMakeable(meals, stock);
    } catch (error) {
      // A dashboard stat must never take the dashboard down.
      logger.error('countMakeable failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  async list(query: { cuisine?: string; limit?: number }): Promise<ServiceResult<MealView[]>> {
    const filter: Record<string, unknown> = { status: 'published' };
    if (query.cuisine !== undefined) filter['cuisines'] = query.cuisine;
    const meals = await MealModel.find(filter).limit(query.limit ?? 50).exec();
    return ok(meals.map(toMealView));
  }

  /**
   * One meal, with everything the detail screen needs — including how it sits
   * against what this person has been eating.
   */
  async detail(mealId: string, ownerId: string): Promise<ServiceResult<unknown>> {
    const meal = await MealModel.findOne({ _id: mealId, status: 'published' }).exec();
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const [stock, favourite, recent] = await Promise.all([
      StockItemModel.find({ ownerId }).exec(),
      FavouriteModel.findOne({ ownerId, mealId }).exec(),
      CookedMealModel.find({ ownerId }).sort({ cookedAt: -1 }).limit(10).exec(),
    ]);

    const match = rankMeals([meal], stock, 1)[0];
    const suggestion = match === undefined ? null : toSuggestionView(match, favourite !== null);

    const timesCooked = recent.filter((r) => r.mealId === mealId).length;
    const last = recent[0];

    return ok({
      ...suggestion,
      history: {
        times_cooked_recently: timesCooked,
        last_cooked_at: isoOrNull(recent.find((r) => r.mealId === mealId)?.cookedAt),
        // Why this suits after the last thing they cooked. Deliberately plain
        // and honest — it is an observation, not a claim of insight.
        why_now:
          last === undefined
            ? 'This would be the first meal you log here.'
            : last.mealName === meal.name
              ? `You cooked this last time. Cooking it again is fine — it is here because it fits your kitchen.`
              : `Your last meal was ${last.mealName}. This is a change from that.`,
      },
    });
  }

  /**
   * Turns a meal the assistant INVENTED into one we actually have.
   *
   * The chat can name a dish that is not in the database — that is fine and
   * often the best answer. But a named dish nobody can open is a dead end, so
   * opening one generates the full recipe, saves it, and hands back a real id.
   * The interface then swaps the URL for that id, and every future prompt sees
   * the meal as one of ours.
   *
   * Idempotent on the name: asking twice returns the meal we already made,
   * rather than a second slightly-different copy of the same dish.
   */
  async generateFromName(name: string, ownerId: string): Promise<ServiceResult<{ meal_id: string }>> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.BAD_REQUEST);
    }

    // Case-insensitive exact match, escaped — a dish called "Ewa Agoyin (hot)"
    // must not be read as a regular expression.
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await MealModel.findOne({
      name: { $regex: `^${escaped}$`, $options: 'i' },
      status: 'published',
    }).exec();

    if (existing !== null) return ok({ meal_id: existing._id });

    const answer = await aiService.call({
      promptId: PROMPT_IDS.RECIPE_GENERATE,
      schema: GeneratedRecipeSchema,
      userPrompt: `Write the full recipe for: ${trimmed}`,
      ownerId,
      tier: 'large',
    });

    if (!answer.ok || answer.data === null) {
      logger.warn('recipe generation failed', { name: trimmed, error: answer.error });
      return fail(
        ERROR_CODES.UPSTREAM_FAILURE,
        MESSAGE_KEYS.meals.NOT_FOUND,
        HTTP_STATUS.UNAVAILABLE,
        { rejectionReason: 'recipe_generation_failed' },
      );
    }

    const recipe = answer.data;

    // Ingredients are resolved to OUR catalogue here, never by the model — it
    // would invent ids. An unresolved name still stores, it simply cannot take
    // part in matching.
    const ingredients = recipe.ingredients.map((item) => {
      const match = resolveIngredient(item.name);
      return {
        catalogueId: match?.id ?? null,
        name: match?.name ?? item.name,
        // The generator writes quantities as prose ("2 medium", "a handful"),
        // which is honest for a generated recipe — so it is kept as the unit
        // rather than forced into a number nobody measured.
        quantity: null,
        unit: item.quantity,
        optional: false,
      };
    });

    const meal = await MealModel.create({
      slug: slugify(recipe.name),
      name: recipe.name,
      // Labelled `ai` FOREVER. Provenance is shown on every card, and a
      // generated recipe quietly marked `seed` is the one lie this product
      // cannot afford.
      source: 'ai',
      status: 'published',
      cuisines: recipe.cuisines,
      difficulty: recipe.difficulty,
      cookTimeMinutes: recipe.cookTimeMinutes,
      serves: recipe.serves,
      whatMakesItGood: recipe.whatMakesItGood,
      description: recipe.whatMakesItGood,
      ingredients,
      steps: recipe.steps,
      ingredientKeys: ingredients.flatMap((i) => (i.catalogueId === null ? [] : [i.catalogueId])),
      heroIcon: null,
      createdBy: ownerId,
    });

    logger.info('generated a meal from a name', { meal_id: meal._id, name: recipe.name });
    return ok({ meal_id: meal._id });
  }

  async listFavourites(ownerId: string): Promise<ServiceResult<MealView[]>> {
    const favourites = await FavouriteModel.find({ ownerId }).sort({ createdAt: -1 }).exec();
    const meals = await MealModel.find({ _id: { $in: favourites.map((f) => f.mealId) } }).exec();
    // Preserve the order favourites were saved in, not Mongo's.
    const order = new Map(favourites.map((f, i) => [f.mealId, i]));
    return ok(
      meals
        .sort((a, b) => (order.get(a._id) ?? 0) - (order.get(b._id) ?? 0))
        .map(toMealView),
    );
  }

  /** Favouriting twice is the same as once — the unique index makes it idempotent. */
  async favourite(mealId: string, ownerId: string): Promise<ServiceResult<null>> {
    const meal = await MealModel.findById(mealId).exec();
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    await FavouriteModel.updateOne({ ownerId, mealId }, { $setOnInsert: { ownerId, mealId } }, { upsert: true }).exec();
    return ok(null);
  }

  async unfavourite(mealId: string, ownerId: string): Promise<ServiceResult<null>> {
    await FavouriteModel.deleteOne({ ownerId, mealId }).exec();
    return ok(null);
  }

  /**
   * Records a cook and takes the ingredients out of the kitchen.
   *
   * This is the standing kitchen's core promise: stock moves as a side-effect
   * of cooking, and nobody counts anything.
   */
  async markCooked(mealId: string, ownerId: string): Promise<ServiceResult<null>> {
    const meal = await MealModel.findById(mealId).exec();
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    await CookedMealModel.create({ ownerId, mealId, mealName: meal.name });

    await stockService.consume(
      ownerId,
      meal.ingredients
        .filter((i) => i.quantity !== null && i.unit !== null)
        .map((i) => ({ name: i.name, quantity: i.quantity ?? 0, unit: i.unit ?? 'piece' })),
      `Cooked ${meal.name}`,
    );

    logger.info('meal cooked', { user_id: ownerId, meal_id: mealId });

    // Cooking is the most common way something runs out, and the moment it
    // happens is when the reminder is worth having. Queued, not sent: the job
    // owns every gate, and cooking must not wait on an email.
    void notifyStockDropped(ownerId).catch((error: unknown) => {
      logger.error('could not queue the low-stock check', {
        user_id: ownerId,
        error: error instanceof Error ? error : String(error),
      });
    });

    return ok(null);
  }
}

export const mealsService = MealsService.getInstance();

/** A url-safe slug, unique enough with the random suffix behind it. */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base.length > 0 ? base : 'meal';
}
