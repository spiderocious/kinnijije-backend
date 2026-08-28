import { createHash } from 'node:crypto';
import { isoOrNull } from '@lib/dates.js';

import { CookedMealModel } from '@features/meals/meals.model.js';
import { StockMovementModel } from '@features/stock/stock.model.js';
import { ok, type ServiceResult } from '@lib/service-result.js';
import { byId } from '@shared/catalogue/index.js';

import { WeekInsightModel } from './insights.model.js';

/** Under this many meals, anything we said would be a guess. */
export const MIN_MEALS_FOR_INSIGHT = 4;

export interface WeekSummary {
  /** Seven days, oldest first, each with what was cooked. */
  days: { date: string; label: string; meals: string[] }[];
  total_meals: number;
  distinct_meals: number;
  /** What they cooked most, with counts. */
  repeats: { name: string; times: number }[];
  /** Rough, from catalogue costs. Explicitly an estimate. */
  estimated_spend: number;
  /** Ingredients that moved out — what actually got used. */
  used_most: { name: string; times: number }[];
  /** True when there is too little to say anything honest. */
  too_early: boolean;
  /** The AI reading, if one has been computed. */
  reading: unknown;
  reading_computed_at: string | null;
}

const DAY_MS = 86_400_000;

export class InsightsService {
  private static instance: InsightsService | undefined;

  static getInstance(): InsightsService {
    InsightsService.instance ??= new InsightsService();
    return InsightsService.instance;
  }

  /**
   * The week, worked out in code.
   *
   * Everything here is deterministic — the AI reading is an addition on top,
   * never the source of the numbers. A model must not be the thing that counts.
   */
  async weekSummary(ownerId: string): Promise<ServiceResult<WeekSummary>> {
    const since = new Date(Date.now() - 7 * DAY_MS);

    const [cooked, movements, cached] = await Promise.all([
      CookedMealModel.find({ ownerId, cookedAt: { $gte: since } }).sort({ cookedAt: 1 }).exec(),
      StockMovementModel.find({ ownerId, createdAt: { $gte: since } }).exec(),
      WeekInsightModel.findOne({ ownerId }).exec(),
    ]);

    // Seven day buckets, oldest first, so the strip renders in order even for
    // days with nothing in them.
    const days: WeekSummary['days'] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * DAY_MS);
      const key = day.toISOString().slice(0, 10);
      days.push({
        date: key,
        label: day.toLocaleDateString('en', { weekday: 'short' }),
        meals: cooked
          .filter((c) => (isoOrNull(c.cookedAt) ?? '').slice(0, 10) === key)
          .map((c) => c.mealName),
      });
    }

    const counts = new Map<string, number>();
    for (const meal of cooked) counts.set(meal.mealName, (counts.get(meal.mealName) ?? 0) + 1);

    const usage = new Map<string, number>();
    let spend = 0;
    for (const move of movements) {
      // Only outward moves are "used". Adding stock is not consumption.
      if (move.delta < 0) usage.set(move.name, (usage.get(move.name) ?? 0) + 1);
      // Only inward moves cost money.
      if (move.delta > 0) {
        const item = byId(move.name) ?? null;
        if (item !== null) spend += item.costNgn * Math.abs(move.delta);
      }
    }

    return ok({
      days,
      total_meals: cooked.length,
      distinct_meals: counts.size,
      repeats: [...counts.entries()]
        .filter(([, times]) => times > 1)
        .sort((a, b) => b[1] - a[1])
        .map(([name, times]) => ({ name, times })),
      estimated_spend: Math.round(spend),
      used_most: [...usage.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, times]) => ({ name, times })),
      too_early: cooked.length < MIN_MEALS_FOR_INSIGHT,
      reading: cached?.payload ?? null,
      reading_computed_at: isoOrNull(cached?.computedAt),
    });
  }

  /**
   * A cheap signature of the week's data.
   *
   * If this has not changed, neither has the answer — so there is no reason to
   * pay for another model call. Cooked meals and stock movements are the only
   * inputs, so they are the only things in the hash.
   */
  async fingerprint(ownerId: string): Promise<string> {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [cooked, moves] = await Promise.all([
      CookedMealModel.find({ ownerId, cookedAt: { $gte: since } }).select('mealName cookedAt').exec(),
      StockMovementModel.countDocuments({ ownerId, createdAt: { $gte: since } }),
    ]);

    const material = cooked.map((c) => `${c.mealName}@${isoOrNull(c.cookedAt)}`).join('|');
    return createHash('sha256').update(`${material}::${String(moves)}`).digest('hex').slice(0, 32);
  }

  /** Whether a fresh reading is worth computing. */
  async needsRecompute(ownerId: string): Promise<boolean> {
    const [cached, current] = await Promise.all([
      WeekInsightModel.findOne({ ownerId }).exec(),
      this.fingerprint(ownerId),
    ]);

    if (cached === null) return true;
    if (cached.dataFingerprint !== current) return true;

    // Even unchanged data gets a refresh once an hour — the time of week and
    // what is expiring both move on their own.
    return Date.now() - cached.computedAt.getTime() > 60 * 60 * 1000;
  }

  async saveReading(ownerId: string, payload: unknown): Promise<void> {
    await WeekInsightModel.findOneAndUpdate(
      { ownerId },
      {
        $set: {
          dataFingerprint: await this.fingerprint(ownerId),
          payload,
          computedAt: new Date(),
        },
      },
      { upsert: true },
    ).exec();
  }
}

export const insightsService = InsightsService.getInstance();
