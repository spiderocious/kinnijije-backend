import { MealModel } from '@features/meals/meals.model.js';
import { isoOrNull } from '@lib/dates.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { resolve as resolveIngredient } from '@shared/catalogue/lookup.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

export interface RecipeInput {
  name: string;
  source?: 'seed' | 'ai';
  status?: 'draft' | 'published';
  cuisines?: string[];
  difficulty: 'easy' | 'medium' | 'involved';
  cook_time_minutes: number;
  serves: number;
  what_makes_it_good: string;
  description?: string;
  hero_icon?: string | null;
  ingredients: { name: string; quantity?: number | null; unit?: string | null; optional?: boolean }[];
  steps: { index: number; heading: string; description: string; est_minutes: number }[];
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base.length > 0 ? base : 'meal';
}

/**
 * The recipes half of the console.
 *
 * Ingredients are resolved to the catalogue on the way IN, so a recipe that
 * cannot take part in matching is visible as such the moment it is saved rather
 * than silently never being suggested.
 */
export class AdminRecipesService {
  private static instance: AdminRecipesService | undefined;

  static getInstance(): AdminRecipesService {
    AdminRecipesService.instance ??= new AdminRecipesService();
    return AdminRecipesService.instance;
  }

  async list(query: {
    search?: string;
    status?: string;
    source?: string;
    limit?: number;
    skip?: number;
  }): Promise<ServiceResult<{ items: unknown[]; total: number }>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter['status'] = query.status;
    if (query.source !== undefined) filter['source'] = query.source;
    if (query.search !== undefined && query.search.length > 0) {
      // Escaped: a search for "Jollof (party)" must not be read as a regex.
      filter['name'] = { $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    const limit = Math.min(query.limit ?? 50, 200);
    const [rows, total] = await Promise.all([
      MealModel.find(filter).sort({ createdAt: -1 }).skip(query.skip ?? 0).limit(limit).exec(),
      MealModel.countDocuments(filter).exec(),
    ]);

    return ok({
      items: rows.map((meal) => ({
        id: meal._id,
        name: meal.name,
        slug: meal.slug,
        source: meal.source,
        status: meal.status,
        difficulty: meal.difficulty,
        cook_time_minutes: meal.cookTimeMinutes,
        serves: meal.serves,
        ingredient_count: meal.ingredients.length,
        matched_ingredients: meal.ingredientKeys.length,
        step_count: meal.steps.length,
        created_at: isoOrNull(meal.createdAt),
      })),
      total,
    });
  }

  async detail(mealId: string): Promise<ServiceResult<unknown>> {
    const meal = await MealModel.findById(mealId).exec();
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    return ok({
      id: meal._id,
      slug: meal.slug,
      name: meal.name,
      source: meal.source,
      status: meal.status,
      cuisines: meal.cuisines,
      difficulty: meal.difficulty,
      cook_time_minutes: meal.cookTimeMinutes,
      serves: meal.serves,
      what_makes_it_good: meal.whatMakesItGood,
      description: meal.description,
      hero_icon: meal.heroIcon,
      ingredients: meal.ingredients.map((i) => ({
        catalogue_id: i.catalogueId,
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        optional: i.optional,
        /** False means it can never be matched against somebody's stock. */
        matched: i.catalogueId !== null,
      })),
      steps: meal.steps,
      ingredient_keys: meal.ingredientKeys,
      created_by: meal.createdBy,
      created_at: isoOrNull(meal.createdAt),
      updated_at: isoOrNull(meal.updatedAt),
    });
  }

  /** One recipe in. Returns the id and how much of it we could match. */
  async create(input: RecipeInput, actorId: string): Promise<ServiceResult<{ id: string; matched: number; unmatched: string[] }>> {
    const ingredients = input.ingredients.map((item) => {
      const match = resolveIngredient(item.name);
      return {
        catalogueId: match?.id ?? null,
        name: match?.name ?? item.name,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        optional: item.optional ?? false,
      };
    });

    const meal = await MealModel.create({
      slug: slugify(input.name),
      name: input.name,
      source: input.source ?? 'seed',
      status: input.status ?? 'published',
      cuisines: input.cuisines ?? ['nigerian'],
      difficulty: input.difficulty,
      cookTimeMinutes: input.cook_time_minutes,
      serves: input.serves,
      whatMakesItGood: input.what_makes_it_good,
      description: input.description ?? input.what_makes_it_good,
      ingredients,
      steps: input.steps.map((s) => ({
        index: s.index,
        heading: s.heading,
        description: s.description,
        estMinutes: s.est_minutes,
      })),
      ingredientKeys: ingredients.flatMap((i) => (i.catalogueId === null ? [] : [i.catalogueId])),
      heroIcon: input.hero_icon ?? null,
      createdBy: actorId,
    });

    const unmatched = ingredients.filter((i) => i.catalogueId === null).map((i) => i.name);
    logger.info('recipe created', { meal_id: meal._id, unmatched: unmatched.length });

    return ok({ id: meal._id, matched: meal.ingredientKeys.length, unmatched });
  }

  /**
   * Many recipes at once.
   *
   * Each is attempted on its own and reported on its own — one malformed row in
   * a paste of forty must not discard the other thirty-nine.
   */
  async createBulk(
    inputs: RecipeInput[],
    actorId: string,
  ): Promise<ServiceResult<{ created: number; failed: number; results: unknown[] }>> {
    const results: unknown[] = [];
    let created = 0;
    let failed = 0;

    for (const [index, input] of inputs.entries()) {
      try {
        const result = await this.create(input, actorId);
        if (result.success) {
          created += 1;
          results.push({ index, name: input.name, ok: true, id: result.data.id, unmatched: result.data.unmatched });
        } else {
          failed += 1;
          results.push({ index, name: input.name, ok: false, error: result.code });
        }
      } catch (error) {
        failed += 1;
        results.push({
          index,
          name: input.name,
          ok: false,
          error: error instanceof Error ? error.message : 'Could not save this one',
        });
      }
    }

    logger.info('bulk recipe import finished', { created, failed });
    return ok({ created, failed, results });
  }

  async setStatus(mealId: string, status: 'draft' | 'published'): Promise<ServiceResult<null>> {
    const result = await MealModel.updateOne({ _id: mealId }, { $set: { status } }).exec();
    if (result.matchedCount === 0) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(null);
  }

  async remove(mealId: string): Promise<ServiceResult<null>> {
    const result = await MealModel.deleteOne({ _id: mealId }).exec();
    if (result.deletedCount === 0) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(null);
  }
}

export const adminRecipesService = AdminRecipesService.getInstance();
