import type { Model } from 'mongoose';

import { ChatMessageModel } from '@features/chat/chat.model.js';
import { FileModel } from '@features/files/files.model.js';
import { MarketItemModel } from '@features/market/market.model.js';
import { CookedMealModel, FavouriteModel, MealModel } from '@features/meals/meals.model.js';
import { StockItemModel } from '@features/stock/stock.model.js';
import { UserModel } from '@features/users/users.model.js';
import { AiLogModel } from '@lib/ai/ai-log.model.js';
import { JobModel } from '@lib/jobs/jobs.model.js';
import { ok, type ServiceResult } from '@lib/service-result.js';

/** Everything the console shows at a glance, in one round trip. */
export interface AdminOverview {
  users: {
    total: number;
    by_status: Record<string, number>;
    by_role: Record<string, number>;
    onboarded: number;
    new_this_week: number;
  };
  meals: { total: number; published: number; draft: number; seed: number; ai: number };
  activity: {
    cooked_all_time: number;
    cooked_this_week: number;
    favourites: number;
    chat_messages: number;
    chat_mocked: number;
  };
  kitchen: { stock_items: number; market_items: number; market_unbought: number; files: number };
  jobs: { total: number; by_status: Record<string, number>; failed_last_day: number };
  ai: {
    calls: number;
    failed: number;
    calls_last_day: number;
    total_tokens: number;
    avg_duration_ms: number;
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
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
    ]);

    const totals = aiTotals[0] as { tokens?: number; duration?: number } | undefined;

    return ok({
      users: {
        total: userTotal,
        by_status: usersByStatus,
        by_role: usersByRole,
        onboarded,
        new_this_week: newUsers,
      },
      meals: {
        total: mealTotal,
        published: mealPublished,
        draft: mealTotal - mealPublished,
        seed: mealSeed,
        ai: mealAi,
      },
      activity: {
        cooked_all_time: cookedAll,
        cooked_this_week: cookedWeek,
        favourites,
        chat_messages: chatTotal,
        chat_mocked: chatMocked,
      },
      kitchen: {
        stock_items: stockItems,
        market_items: marketItems,
        market_unbought: marketUnbought,
        files,
      },
      jobs: { total: jobTotal, by_status: jobsByStatus, failed_last_day: jobsFailedDay },
      ai: {
        calls: aiCalls,
        failed: aiFailed,
        calls_last_day: aiCallsDay,
        total_tokens: Math.round(totals?.tokens ?? 0),
        avg_duration_ms: Math.round(totals?.duration ?? 0),
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
