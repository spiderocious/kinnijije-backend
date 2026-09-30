import type { Model } from 'mongoose';

import { ChatMessageModel } from '@features/chat/chat.model.js';
import { FileModel } from '@features/files/files.model.js';
import { MarketItemModel } from '@features/market/market.model.js';
import { DecideHistoryModel } from '@features/decide/decide-history.model.js';
import { CookedMealModel, FavouriteModel, MealModel } from '@features/meals/meals.model.js';
import { StockItemModel } from '@features/stock/stock.model.js';
import { UserModel } from '@features/users/users.model.js';
import { AiLogModel } from '@lib/ai/ai-log.model.js';
import { JobModel } from '@lib/jobs/jobs.model.js';
import { ok, type ServiceResult } from '@lib/service-result.js';

import { adminDecideService } from '../decide/admin-decide.service.js';
import { DAY_MS, SERIES_DAYS, dailyCounts, trendPercent, type DailyCount } from './admin-series.js';

/** Everything the console shows at a glance, in one round trip. */
export interface AdminOverview {
  users: {
    total: number;
    by_status: Record<string, number>;
    by_role: Record<string, number>;
    onboarded: number;
    new_this_week: number;
    /** Percent change on the previous seven days. Null when there is no base. */
    trend: number | null;
    daily: DailyCount[];
  };
  meals: {
    total: number;
    published: number;
    draft: number;
    seed: number;
    ai: number;
    /** Recipes carrying at least one image. */
    with_photo: number;
  };
  activity: {
    cooked_all_time: number;
    cooked_this_week: number;
    favourites: number;
    chat_messages: number;
    chat_mocked: number;
    /** Change on the previous seven days. */
    cooked_trend: number | null;
  };
  kitchen: { stock_items: number; market_items: number; market_unbought: number; files: number };
  jobs: { total: number; by_status: Record<string, number>; failed_last_day: number };
  /**
   * The anonymous decide flow, at a glance.
   *
   * Enough to notice something is wrong; the decide screen answers why.
   */
  decide: {
    decisions: number;
    today: number;
    distinct_visitors: number;
    /** Decisions that returned no meal. The number to drive to zero. */
    empty_verdicts: number;
    /** How often the model's answer was actually used. */
    ai_framed: number;
    empty_today: number;
    empty_yesterday: number;
    this_week: number;
    previous_week: number;
    rejected: number;
    daily: DailyCount[];
    /** Change on the previous seven days. */
    trend: number | null;
    /**
     * Saved decisions on file, across every account.
     *
     * Every row belongs to an account, so this doubles as "decisions made
     * while signed in". Remixes are deliberately NOT here: the flow records
     * them client-side only, and a server figure would be a guess wearing the
     * same styling as the real counts beside it.
     */
    saved: number;
  };
  ai: {
    calls: number;
    failed: number;
    calls_last_day: number;
    total_tokens: number;
    avg_duration_ms: number;
    /** Percentiles, which say far more about a tail than an average does. */
    median_duration_ms: number;
    p95_duration_ms: number;
    tokens_last_day: number;
    median_tokens: number;
    by_prompt: { prompt_id: string; calls: number; failed: number; tokens: number }[];
  };
}

/** Counts grouped by one field, as a plain object the interface can read. */
async function countBy<T>(
  collection: Model<T>,
  field: string,
): Promise<Record<string, number>> {
  const rows = await collection
    .aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    ])
    .exec();

  const out: Record<string, number> = {};
  for (const row of rows) out[String(row._id)] = Number(row.count);
  return out;
}

/**
 * Percentiles, without `$percentile`.
 *
 * That operator needs MongoDB 7, and this has to run wherever the app is
 * deployed — so the values are sorted and indexed instead. Bounded by
 * `PERCENTILE_SAMPLE` because sorting every AI call ever made to find a median
 * is a table scan that grows forever; the newest N are what a latency question
 * is actually about anyway.
 */
const PERCENTILE_SAMPLE = 5_000;

async function durationPercentiles(): Promise<{ median: number; p95: number }> {
  const rows = await AiLogModel.find({}, { durationMs: 1, _id: 0 })
    .sort({ createdAt: -1 })
    .limit(PERCENTILE_SAMPLE)
    .lean()
    .exec();

  if (rows.length === 0) return { median: 0, p95: 0 };

  const sorted = rows.map((row) => row.durationMs).sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

  return { median: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
}

/** The median token count, over the same bounded sample. */
async function medianTokens(): Promise<number> {
  const rows = await AiLogModel.find(
    { totalTokens: { $ne: null } },
    { totalTokens: 1, _id: 0 },
  )
    .sort({ createdAt: -1 })
    .limit(PERCENTILE_SAMPLE)
    .lean()
    .exec();

  if (rows.length === 0) return 0;
  const sorted = rows.map((row) => row.totalTokens ?? 0).sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);
}

export class AdminDashboardService {
  private static instance: AdminDashboardService | undefined;

  static getInstance(): AdminDashboardService {
    AdminDashboardService.instance ??= new AdminDashboardService();
    return AdminDashboardService.instance;
  }

  /**
   * The whole picture, in ONE call.
   *
   * Every count is a real query — nothing here is estimated or cached, because
   * a dashboard that quietly shows stale numbers is worse than no dashboard.
   */
  async overview(): Promise<ServiceResult<AdminOverview>> {
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);
    const dayAgo = new Date(Date.now() - DAY_MS);
    const twoWeeksAgo = new Date(Date.now() - 14 * DAY_MS);
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const seriesFrom = new Date(midnight.getTime() - (SERIES_DAYS - 1) * DAY_MS);

    const [
      userTotal,
      usersByStatus,
      usersByRole,
      onboarded,
      newUsers,
      mealTotal,
      mealPublished,
      mealSeed,
      mealAi,
      cookedAll,
      cookedWeek,
      favourites,
      chatTotal,
      chatMocked,
      stockItems,
      marketItems,
      marketUnbought,
      files,
      jobTotal,
      jobsByStatus,
      jobsFailedDay,
      aiCalls,
      aiFailed,
      aiCallsDay,
      aiTotals,
      aiByPrompt,
      usersPreviousWeek,
      usersDaily,
      mealsWithPhoto,
      cookedPreviousWeek,
      aiTokensDay,
      aiPercentiles,
      aiMedianTokens,
      savedDecisions,
    ] = await Promise.all([
      UserModel.countDocuments().exec(),
      countBy(UserModel, 'status'),
      countBy(UserModel, 'role'),
      UserModel.countDocuments({ onboardingCompletedAt: { $ne: null } }).exec(),
      UserModel.countDocuments({ createdAt: { $gte: weekAgo } }).exec(),
      MealModel.countDocuments().exec(),
      MealModel.countDocuments({ status: 'published' }).exec(),
      MealModel.countDocuments({ source: 'seed' }).exec(),
      MealModel.countDocuments({ source: 'ai' }).exec(),
      CookedMealModel.countDocuments().exec(),
      CookedMealModel.countDocuments({ cookedAt: { $gte: weekAgo } }).exec(),
      FavouriteModel.countDocuments().exec(),
      ChatMessageModel.countDocuments().exec(),
      ChatMessageModel.countDocuments({ mocked: true }).exec(),
      StockItemModel.countDocuments().exec(),
      MarketItemModel.countDocuments().exec(),
      // The model stores a DATE, not a boolean — `bought: false` is not a
      // path that exists, and strictQuery turns that into a 500 rather than
      // silently counting nothing.
      MarketItemModel.countDocuments({ boughtAt: null }).exec(),
      FileModel.countDocuments().exec(),
      JobModel.countDocuments().exec(),
      countBy(JobModel, 'status'),
      JobModel.countDocuments({ status: 'failed', createdAt: { $gte: dayAgo } }).exec(),
      AiLogModel.countDocuments().exec(),
      AiLogModel.countDocuments({ ok: false }).exec(),
      AiLogModel.countDocuments({ createdAt: { $gte: dayAgo } }).exec(),
      AiLogModel.aggregate([
        {
          $group: {
            _id: null,
            tokens: { $sum: '$totalTokens' },
            duration: { $avg: '$durationMs' },
          },
        },
      ]).exec(),
      AiLogModel.aggregate([
        {
          $group: {
            _id: '$promptId',
            calls: { $sum: 1 },
            failed: { $sum: { $cond: ['$ok', 0, 1] } },
            tokens: { $sum: '$totalTokens' },
          },
        },
        { $sort: { calls: -1 } },
      ]).exec(),
      UserModel.countDocuments({ createdAt: { $gte: twoWeeksAgo, $lt: weekAgo } }).exec(),
      dailyCounts(UserModel, seriesFrom),
      MealModel.countDocuments({ 'images.0': { $exists: true } }).exec(),
      CookedMealModel.countDocuments({
        cookedAt: { $gte: twoWeeksAgo, $lt: weekAgo },
      }).exec(),
      AiLogModel.aggregate([
        { $match: { createdAt: { $gte: dayAgo } } },
        { $group: { _id: null, tokens: { $sum: '$totalTokens' } } },
      ]).exec(),
      durationPercentiles(),
      medianTokens(),
      DecideHistoryModel.countDocuments().exec(),
    ]);

    const totals = aiTotals[0] as { tokens?: number; duration?: number } | undefined;

    // Its own service, because the decide flow owns the shape of its own
    // numbers and the dashboard should not be querying another feature's
    // collection directly.
    const decideSummary = await adminDecideService.summary();

    return ok({
      users: {
        total: userTotal,
        by_status: usersByStatus,
        by_role: usersByRole,
        onboarded,
        new_this_week: newUsers,
        trend: trendPercent(newUsers, usersPreviousWeek),
        daily: usersDaily,
      },
      meals: {
        total: mealTotal,
        published: mealPublished,
        draft: mealTotal - mealPublished,
        seed: mealSeed,
        ai: mealAi,
        with_photo: mealsWithPhoto,
      },
      activity: {
        cooked_all_time: cookedAll,
        cooked_this_week: cookedWeek,
        favourites,
        chat_messages: chatTotal,
        chat_mocked: chatMocked,
        cooked_trend: trendPercent(cookedWeek, cookedPreviousWeek),
      },
      kitchen: {
        stock_items: stockItems,
        market_items: marketItems,
        market_unbought: marketUnbought,
        files,
      },
      jobs: { total: jobTotal, by_status: jobsByStatus, failed_last_day: jobsFailedDay },
      decide: {
        ...decideSummary,
        trend: trendPercent(decideSummary.this_week, decideSummary.previous_week),
        // Every saved decision belongs to an account, so this doubles as the
        // count of decisions made while signed in.
        saved: savedDecisions,
      },
      ai: {
        calls: aiCalls,
        failed: aiFailed,
        calls_last_day: aiCallsDay,
        total_tokens: Math.round(totals?.tokens ?? 0),
        avg_duration_ms: Math.round(totals?.duration ?? 0),
        median_duration_ms: aiPercentiles.median,
        p95_duration_ms: aiPercentiles.p95,
        tokens_last_day: Math.round(
          (aiTokensDay[0] as { tokens?: number } | undefined)?.tokens ?? 0,
        ),
        median_tokens: aiMedianTokens,
        by_prompt: (aiByPrompt as { _id: string; calls: number; failed: number; tokens: number }[]).map(
          (row) => ({
            prompt_id: row._id,
            calls: row.calls,
            failed: row.failed,
            tokens: Math.round(row.tokens ?? 0),
          }),
        ),
      },
    });
  }
}

export const adminDashboardService = AdminDashboardService.getInstance();
