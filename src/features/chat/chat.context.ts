import { CookedMealModel, MealModel } from '@features/meals/meals.model.js';
import { StockItemModel } from '@features/stock/stock.model.js';
import { UserModel } from '@features/users/users.model.js';
import { logger } from '@lib/logger/index.js';

/**
 * What every question carries with it.
 *
 * This is the difference between an assistant and a search box. The cook does
 * not repeat their kitchen, their tastes or the time — it is prepended, every
 * single time, so the answer is about THEM.
 */
export interface ChatContext {
  stock: string[];
  recentMeals: string[];
  cuisines: string[];
  difficulty: string;
  timeOfDay: string;
  weather: string | null;
  /** Meals the model may reference by id. Anything else it must mark as its own. */
  availableMeals: { id: string; name: string; cuisines: string[]; time: number }[];
}

function describeTimeOfDay(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'late night';
  if (hour < 11) return 'morning';
  if (hour < 15) return 'afternoon';
  if (hour < 19) return 'early evening';
  return 'night';
}

export async function buildChatContext(ownerId: string): Promise<ChatContext> {
  const [user, stock, cooked, meals] = await Promise.all([
    UserModel.findById(ownerId).exec(),
    StockItemModel.find({ ownerId, quantity: { $gt: 0 } }).exec(),
    CookedMealModel.find({ ownerId }).sort({ cookedAt: -1 }).limit(10).exec(),
    MealModel.find({ status: 'published' }).select('_id name cuisines cookTimeMinutes').exec(),
  ]);

  return {
    stock: stock.map((s) => `${s.name} (${String(s.quantity)} ${s.unit})`),
    recentMeals: cooked.map((c) => c.mealName),
    cuisines: user?.prefs?.cuisines ?? [],
    difficulty: user?.prefs?.difficulty ?? 'anything',
    timeOfDay: describeTimeOfDay(new Date()),
    weather: await lookupWeather(user?.city ?? null, user?.country ?? null),
    availableMeals: meals.map((m) => ({
      id: m._id,
      name: m.name,
      cuisines: m.cuisines,
      time: m.cookTimeMinutes,
    })),
  };
}

/**
 * Weather for the cook's city.
 *
 * Cached per city per hour rather than fetched per question — otherwise every
 * message in a conversation is a separate API call for a number that changes
 * hourly at most.
 *
 * Degrades to null rather than failing: an answer without weather is slightly
 * less tailored, which is far better than no answer at all.
 */
const weatherCache = new Map<string, { value: string; expires: number }>();
const WEATHER_TTL_MS = 60 * 60 * 1000;

async function lookupWeather(city: string | null, country: string | null): Promise<string | null> {
  if (city === null || city.length === 0) return null;

  const key = `${city},${country ?? ''}`.toLowerCase();
  const cached = weatherCache.get(key);
  if (cached !== undefined && cached.expires > Date.now()) return cached.value;

  try {
    // Open-Meteo needs no API key, which keeps this from being a blocker.
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
    );
    if (!geo.ok) return null;
    const geoData = (await geo.json()) as { results?: { latitude: number; longitude: number }[] };
    const place = geoData.results?.[0];
    if (place === undefined) return null;

    const forecast = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${String(place.latitude)}&longitude=${String(place.longitude)}&current=temperature_2m,precipitation`,
    );
    if (!forecast.ok) return null;
    const data = (await forecast.json()) as {
      current?: { temperature_2m?: number; precipitation?: number };
    };

    const temp = data.current?.temperature_2m;
    const rain = (data.current?.precipitation ?? 0) > 0;
    if (temp === undefined) return null;

    const value = `${String(Math.round(temp))}°C${rain ? ', raining' : ''} in ${city}`;
    weatherCache.set(key, { value, expires: Date.now() + WEATHER_TTL_MS });
    return value;
  } catch (error) {
    logger.debug('weather lookup failed', {
      city,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Renders the context as the block prepended to every question. */
export function renderContext(context: ChatContext): string {
  const lines = [
    `TIME: ${context.timeOfDay}`,
    context.weather !== null ? `WEATHER: ${context.weather}` : null,
    `THEIR CUISINES: ${context.cuisines.length > 0 ? context.cuisines.join(', ') : 'no preference stated'}`,
    `THEIR DIFFICULTY: ${context.difficulty}`,
    '',
    `IN THEIR KITCHEN RIGHT NOW (${String(context.stock.length)} things):`,
    context.stock.length > 0 ? context.stock.join(', ') : '(nothing recorded)',
    '',
    `RECENTLY COOKED (newest first): ${context.recentMeals.length > 0 ? context.recentMeals.join(', ') : '(nothing yet)'}`,
    '',
    'MEALS THIS APP HAS — you may reference these BY ID. Any dish not in this list',
    'is your own invention and its mealId MUST be null:',
    ...context.availableMeals.map((m) => `  ${m.id} | ${m.name} | ${m.cuisines.join('/')} | ${String(m.time)}min`),
  ];

  return lines.filter((line) => line !== null).join('\n');
}
