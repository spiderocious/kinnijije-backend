import { logger } from '@lib/logger/index.js';

export interface DayWeather {
  /** "28°C, raining in Lagos" — ready to drop into a sentence. */
  summary: string;
  city: string;
  high: number | null;
  low: number | null;
  /** True when rain is forecast at any point today. */
  rain: boolean;
}

/**
 * Today's weather, for one city.
 *
 * Open-Meteo needs no API key, which keeps this from being a blocker on
 * anything. Cached for an hour and degrading to NULL rather than failing: an
 * email without weather is slightly less tailored, which is far better than no
 * email at all.
 */
const cache = new Map<string, { value: DayWeather | null; expires: number }>();
const TTL_MS = 60 * 60 * 1000;

export async function dayWeather(
  city: string | null,
  country: string | null,
): Promise<DayWeather | null> {
  if (city === null || city.trim().length === 0) return null;

  const key = `${city},${country ?? ''}`.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined && cached.expires > Date.now()) return cached.value;

  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
    );
    if (!geo.ok) return null;

    const geoData = (await geo.json()) as { results?: { latitude: number; longitude: number }[] };
    const place = geoData.results?.[0];
    if (place === undefined) return null;

    const forecast = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${String(place.latitude)}` +
        `&longitude=${String(place.longitude)}` +
        `&current=temperature_2m,precipitation` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=1`,
    );
    if (!forecast.ok) return null;

    const data = (await forecast.json()) as {
      current?: { temperature_2m?: number; precipitation?: number };
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
      };
    };

    const now = data.current?.temperature_2m;
    if (now === undefined) return null;

    const high = data.daily?.temperature_2m_max?.[0] ?? null;
    const low = data.daily?.temperature_2m_min?.[0] ?? null;
    const rain =
      (data.daily?.precipitation_sum?.[0] ?? 0) > 0 || (data.current?.precipitation ?? 0) > 0;

    const value: DayWeather = {
      summary: `${String(Math.round(now))}°C${rain ? ', rain about' : ''} in ${city}`,
      city,
      high: high === null ? null : Math.round(high),
      low: low === null ? null : Math.round(low),
      rain,
    };

    cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  } catch (error) {
    logger.debug('weather lookup failed', {
      city,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
