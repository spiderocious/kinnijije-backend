import { mealsService } from '@features/meals/meals.service.js';
import type { MealSuggestionView } from '@features/meals/meals.types.js';
import { stockService } from '@features/stock/stock.service.js';
import { UserModel } from '@features/users/users.model.js';
import { aiService, DailyRundownSchema, PROMPT_IDS } from '@lib/ai/index.js';
import { logger } from '@lib/logger/index.js';
import { dayWeather, type DayWeather } from '@lib/weather/index.js';

export interface RundownMeal {
  id: string;
  name: string;
  minutes: number;
  /** Written by the model. Falls back to our own line when it does not answer. */
  reason: string;
  missing: number;
}

export interface DailyRundown {
  intro: string;
  closing: string | null;
  weather: DayWeather | null;
  expiringToday: { name: string; daysLeft: number }[];
  breakfast: RundownMeal[];
  lunch: RundownMeal[];
  dinner: RundownMeal[];
  thingsIn: number;
}

/**
 * The morning rundown: what is going off, what the day looks like, and what to
 * eat at each of the three times.
 *
 * **The meals are chosen HERE, deterministically.** The matcher already knows
 * what somebody can actually cook; a model asked to pick would invent dishes
 * and ignore the stock. What the model adds is the part code is bad at — one
 * honest line per meal connecting it to the weather, to what is spoiling, to
 * what they have not eaten lately.
 *
 * If the model fails, the rundown still sends with our own plainer lines.
 */

/** Meals short enough to be breakfast. Nobody makes egusi before work. */
const BREAKFAST_MAX_MINUTES = 25;
/** Lunch sits in the middle — quicker than dinner, slower than breakfast. */
const LUNCH_MAX_MINUTES = 50;

/** Our own reason, used until the model gives a better one. */
function plainReason(suggestion: MealSuggestionView, expiring: Set<string>): string {
  const usesExpiring = suggestion.meal.ingredients.some((item) =>
    expiring.has(item.name.toLowerCase()),
  );
  if (usesExpiring) return 'Uses something that wants eating today.';
  if (suggestion.missing.length === 0) return 'You have everything for this one.';
  return `You are ${String(suggestion.missing.length)} thing${suggestion.missing.length === 1 ? '' : 's'} short.`;
}

function toMeal(suggestion: MealSuggestionView, expiring: Set<string>): RundownMeal {
  return {
    id: suggestion.meal.id,
    name: suggestion.meal.name,
    minutes: suggestion.meal.cook_time_minutes,
    reason: plainReason(suggestion, expiring),
    missing: suggestion.missing.length,
  };
}

/**
 * Splits the shortlist across the day by cook time.
 *
 * Deliberately allows the same meal in two slots when there is little to choose
 * from — an empty dinner section is worse than a repeated suggestion.
 */
function splitByTime(
  suggestions: readonly MealSuggestionView[],
  expiring: Set<string>,
): { breakfast: RundownMeal[]; lunch: RundownMeal[]; dinner: RundownMeal[] } {
  const quick = suggestions.filter((s) => s.meal.cook_time_minutes <= BREAKFAST_MAX_MINUTES);
  const middle = suggestions.filter((s) => s.meal.cook_time_minutes <= LUNCH_MAX_MINUTES);

  // Dinner takes the best of everything — it is the meal with time in it.
  const dinner = suggestions.slice(0, 3);
  const lunch = (middle.length > 0 ? middle : suggestions).slice(0, 3);
  const breakfast = (quick.length > 0 ? quick : middle.length > 0 ? middle : suggestions).slice(
    0,
    2,
  );

  return {
    breakfast: breakfast.map((s) => toMeal(s, expiring)),
    lunch: lunch.map((s) => toMeal(s, expiring)),
    dinner: dinner.map((s) => toMeal(s, expiring)),
  };
}

export class RundownService {
  private static instance: RundownService | undefined;

  static getInstance(): RundownService {
    RundownService.instance ??= new RundownService();
    return RundownService.instance;
  }

  /**
   * Builds one person's day.
   *
   * Returns null when there is nothing worth sending — an empty kitchen with
   * nothing cookable produces an email that says so, which is worse than
   * silence.
   */
  async build(ownerId: string): Promise<DailyRundown | null> {
    const [user, dashboard, suggestions] = await Promise.all([
      UserModel.findById(ownerId).select('city country').exec(),
      stockService.dashboard(ownerId, 8),
      mealsService.suggest(ownerId, 8),
    ]);

    if (!dashboard.success) return null;

    const picks = suggestions.success ? suggestions.data : [];
    const thingsIn = dashboard.data.counts.things_in;

    if (thingsIn === 0 && picks.length === 0) return null;

    // "Today" is anything with a day or less left — including things already
    // past, which are the ones most worth naming.
    const expiringToday = dashboard.data.use_first
      .filter((item) => item.days_left !== null && item.days_left <= 1)
      .slice(0, 6)
      .map((item) => ({ name: item.name, daysLeft: item.days_left ?? 0 }));

    const expiringNames = new Set(expiringToday.map((item) => item.name.toLowerCase()));
    const slots = splitByTime(picks, expiringNames);
    const weather = await dayWeather(user?.city ?? null, user?.country ?? null);

    const rundown: DailyRundown = {
      intro:
        thingsIn > 0
          ? `You have ${String(thingsIn)} thing${thingsIn === 1 ? '' : 's'} in the kitchen this morning.`
          : 'Your kitchen is empty this morning.',
      closing: null,
      weather,
      expiringToday,
      ...slots,
      thingsIn,
    };

    // Every meal across the day, deduplicated — the model writes one line per
    // meal, not one per appearance.
    const everyMeal = [...slots.breakfast, ...slots.lunch, ...slots.dinner];
    const unique = [...new Map(everyMeal.map((meal) => [meal.id, meal])).values()];

    if (unique.length === 0) return rundown;

    const written = await this.write(rundown, unique, dashboard.data.counts.things_in);
    if (written === null) return rundown;

    // Apply the model's lines by id. Anything it skipped keeps ours.
    const byId = new Map(written.reasons.map((entry) => [entry.mealId, entry.reason]));
    const apply = (meals: RundownMeal[]): RundownMeal[] =>
      meals.map((meal) => ({ ...meal, reason: byId.get(meal.id) ?? meal.reason }));

    return {
      ...rundown,
      intro: written.intro,
      closing: written.closing,
      breakfast: apply(rundown.breakfast),
      lunch: apply(rundown.lunch),
      dinner: apply(rundown.dinner),
    };
  }

  /** The model's half: the framing and the per-meal lines. */
  private async write(
    rundown: DailyRundown,
    meals: readonly RundownMeal[],
    thingsIn: number,
  ): Promise<{ intro: string; reasons: { mealId: string; reason: string }[]; closing: string | null } | null> {
    const answer = await aiService.call({
      promptId: PROMPT_IDS.DAILY_RUNDOWN,
      schema: DailyRundownSchema,
      userPrompt: [
        `THINGS IN THE KITCHEN: ${String(thingsIn)}`,
        `WEATHER TODAY: ${rundown.weather?.summary ?? '(not known)'}`,
        rundown.weather?.high !== null && rundown.weather !== null
          ? `HIGH ${String(rundown.weather.high)}°C, LOW ${String(rundown.weather.low)}°C${rundown.weather.rain ? ', rain expected' : ''}`
          : '',
        '',
        `GOING OFF TODAY: ${
          rundown.expiringToday.length > 0
            ? rundown.expiringToday.map((item) => item.name).join(', ')
            : '(nothing)'
        }`,
        '',
        'THE MEALS, ALREADY CHOSEN. Write one reason for each id:',
        ...meals.map(
          (meal) =>
            `  ${meal.id} — ${meal.name}, ${String(meal.minutes)} min, ${
              meal.missing === 0 ? 'has everything' : `${String(meal.missing)} missing`
            }`,
        ),
      ]
        .filter((line) => line.length > 0 || line === '')
        .join('\n'),
      ownerId: 'system',
      tier: 'small',
    });

    if (!answer.ok || answer.data === null) {
      logger.warn('rundown wording failed, falling back to our own lines', {
        error: answer.error,
      });
      return null;
    }

    return answer.data;
  }
}

export const rundownService = RundownService.getInstance();
