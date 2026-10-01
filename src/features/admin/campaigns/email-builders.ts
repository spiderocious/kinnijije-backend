import { createHash } from 'node:crypto';

import { insightsService } from '@features/insights/insights.service.js';
import { mealsService } from '@features/meals/meals.service.js';
import { rundownService } from '@features/notifications/rundown.service.js';
import { stockService } from '@features/stock/stock.service.js';
import { EMAIL_KINDS, type EmailKind } from '@lib/mail/email-log.model.js';
import {
  dailyRundownEmail,
  emptyKitchenEmail,
  haveYouEatenEmail,
  lowStockEmail,
  useItUpEmail,
  weeklySummaryEmail,
  type EmailContent,
} from '@lib/mail/templates.js';

/**
 * One builder per automated kind, and the ONLY way any of them is rendered.
 *
 * Shared by the sweep and by the composer deliberately. If the composer
 * rendered email a different way it would be a second implementation that
 * drifts, and "it looked right in the preview" would stop meaning anything.
 *
 * A builder returns null when there is nothing worth sending. That is a
 * different thing from being ineligible: eligibility is a policy floor checked
 * before the build, and null is the build itself finding nothing to say.
 */

export interface BuildSubject {
  readonly _id: string;
  readonly email: string;
  readonly name: string | null;
  readonly city?: string | null;
  readonly prefs?: { cuisines?: string[]; difficulty?: string } | undefined;
}

export interface BuiltEmail {
  readonly content: EmailContent;
  /** What it was built from, for the reviewer. Never the whole payload. */
  readonly inputs: Record<string, unknown>;
}

export type EmailBuilder = (user: BuildSubject) => Promise<BuiltEmail | null>;

/** The morning note. The one that uses a model. */
const buildDailyDigest: EmailBuilder = async (user) => {
  const rundown = await rundownService.build(user._id);
  if (rundown === null) return null;

  return {
    content: dailyRundownEmail(user.name, rundown),
    inputs: {
      things_in: rundown.thingsIn,
      expiring: rundown.expiringToday.map((item) => item.name),
      breakfast: rundown.breakfast.map((meal) => meal.name),
      lunch: rundown.lunch.map((meal) => meal.name),
      dinner: rundown.dinner.map((meal) => meal.name),
      weather: rundown.weather?.summary ?? null,
    },
  };
};

/** Running low, and what it is blocking. */
const buildLowStock: EmailBuilder = async (user) => {
  const dashboard = await stockService.dashboard(user._id, 5);
  if (!dashboard.success || dashboard.data.running_low.length === 0) return null;

  const suggestions = await mealsService.suggest(user._id, 5);
  const lowNames = new Set(dashboard.data.running_low.map((item) => item.name.toLowerCase()));

  // What these are actually blocking. Without it the email is a list of
  // groceries with no reason to care.
  const blocking = suggestions.success
    ? suggestions.data
        .filter((s) => s.missing.some((missing) => lowNames.has(missing.toLowerCase())))
        .slice(0, 3)
        .map((s) => s.meal.name)
    : [];

  if (blocking.length === 0) return null;

  const low = dashboard.data.running_low
    .slice(0, 5)
    .map((item) => ({ name: item.name, reason: item.reason }));

  return {
    content: lowStockEmail(user.name, low, blocking),
    inputs: { running_low: low.map((item) => item.name), blocking },
  };
};

const buildWeeklySummary: EmailBuilder = async (user) => {
  const summary = await insightsService.weekSummary(user._id);
  if (!summary.success) return null;

  const week = summary.data as {
    total_meals: number;
    meals?: { name: string }[];
    reading?: { headline?: string } | null;
    estimated_spend?: number | null;
  };

  return {
    content: weeklySummaryEmail(user.name, {
      cooked: week.total_meals,
      meals: (week.meals ?? []).slice(0, 6).map((meal) => meal.name),
      reading: week.reading?.headline ?? null,
      spent: week.estimated_spend ?? null,
    }),
    inputs: { cooked: week.total_meals, reading: week.reading?.headline ?? null },
  };
};

/** Things that want eating before they turn. */
const buildUseItUp: EmailBuilder = async (user) => {
  const dashboard = await stockService.dashboard(user._id, 8);
  if (!dashboard.success) return null;

  const going = dashboard.data.use_first
    .filter((item) => item.days_left !== null && item.days_left <= 3)
    .slice(0, 5)
    .map((item) => ({ name: item.name, daysLeft: item.days_left ?? 0 }));

  if (going.length === 0) return null;

  const suggestions = await mealsService.suggest(user._id, 5);
  const goingNames = new Set(going.map((item) => item.name.toLowerCase()));
  const meals = suggestions.success
    ? suggestions.data
        .filter((s) => s.meal.ingredients.some((i) => goingNames.has(i.name.toLowerCase())))
        .slice(0, 3)
        .map((s) => ({
          id: s.meal.id,
          name: s.meal.name,
          // Which of the expiring things this meal actually uses — the reason
          // to cook it today rather than a generic suggestion.
          uses: s.meal.ingredients
            .filter((i) => goingNames.has(i.name.toLowerCase()))
            .map((i) => i.name),
        }))
    : [];

  return {
    content: useItUpEmail(user.name, going, meals),
    inputs: { going: going.map((item) => item.name), meals: meals.map((m) => m.name) },
  };
};

/** Nobody has cooked in a while. Gentle, never a scolding. */
const buildHaveYouEaten: EmailBuilder = async (user) => {
  const { CookedMealModel } = await import('@features/meals/meals.model.js');
  const last = await CookedMealModel.findOne({ ownerId: user._id })
    .sort({ cookedAt: -1 })
    .lean()
    .exec();

  const daysQuiet =
    last === null
      ? null
      : Math.floor((Date.now() - new Date(last.cookedAt).getTime()) / 86_400_000);

  // Somebody who cooked yesterday does not need this.
  if (daysQuiet !== null && daysQuiet < 5) return null;

  const suggestions = await mealsService.suggest(user._id, 3);
  const easy = suggestions.success
    ? suggestions.data
        .filter((s) => s.missing.length === 0)
        .slice(0, 3)
        .map((s) => ({
          id: s.meal.id,
          name: s.meal.name,
          minutes: s.meal.cook_time_minutes,
        }))
    : [];

  return {
    content: haveYouEatenEmail(user.name, easy),
    inputs: { days_quiet: daysQuiet, suggestions: easy.map((m) => m.name) },
  };
};

/**
 * Nothing in the kitchen.
 *
 * Suggests from their stated cuisines rather than their stock — the matcher is
 * no use with an empty kitchen, which is the whole segment. The Chowdeck line
 * is included ONLY when a curated place matches their city; a dead "order from
 * X" link in this email is worse than no link.
 */
const buildEmptyKitchen: EmailBuilder = async (user) => {
  const { MealModel } = await import('@features/meals/meals.model.js');
  const cuisines = user.prefs?.cuisines ?? [];

  const meals = await MealModel.find(
    {
      status: 'published',
      ...(cuisines.length > 0 && { cuisines: { $in: cuisines } }),
    },
    { name: 1, slug: 1, cookTimeMinutes: 1 },
  )
    .limit(4)
    .lean()
    .exec();

  if (meals.length === 0) return null;

  // Only if somebody has actually curated a place in their city.
  let orderFrom: { place: string; url: string } | null = null;
  if (user.city !== null && user.city !== undefined && user.city.trim().length > 0) {
    const { ChowdeckPlaceModel } = await import('@features/chowdeck/chowdeck.model.js');
    const place = await ChowdeckPlaceModel.findOne(
      { city: new RegExp(`^${user.city.trim()}$`, 'i'), active: true },
      { name: 1 },
    )
      .lean()
      .exec();

    if (place !== null) {
      orderFrom = { place: place.name, url: 'https://chowdeck.com' };
    }
  }

  return {
    content: emptyKitchenEmail(
      user.name,
      meals.map((meal) => ({ name: meal.name, minutes: meal.cookTimeMinutes })),
      orderFrom,
    ),
    inputs: {
      cuisines,
      city: user.city ?? null,
      suggested: meals.map((meal) => meal.name),
      order_from: orderFrom?.place ?? null,
    },
  };
};

/** Every kind the pipeline can build. A kind absent here cannot be drafted. */
export const BUILDERS: Partial<Record<EmailKind, EmailBuilder>> = {
  [EMAIL_KINDS.DAILY_DIGEST]: buildDailyDigest,
  [EMAIL_KINDS.LOW_STOCK]: buildLowStock,
  [EMAIL_KINDS.WEEKLY_SUMMARY]: buildWeeklySummary,
  [EMAIL_KINDS.USE_IT_UP]: buildUseItUp,
  [EMAIL_KINDS.HAVE_YOU_EATEN]: buildHaveYouEaten,
  [EMAIL_KINDS.EMPTY_KITCHEN]: buildEmptyKitchen,
};

export const BUILDABLE_KINDS = Object.keys(BUILDERS) as EmailKind[];

/** Truncated body fingerprint, for grouping near-identical drafts. */
export const hashBody = (text: string): string =>
  createHash('sha256').update(text.trim()).digest('hex').slice(0, 16);
