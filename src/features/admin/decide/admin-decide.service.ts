import { DecideLogModel, type DecideLogAttributes } from '@features/decide/decide-log.model.js';
import { isoOrNull } from '@lib/dates.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import { DAY_MS, SERIES_DAYS, dailyCounts } from '../dashboard/admin-series.js';

/**
 * What the console can see about the decide flow.
 *
 * Every figure here is a COUNT of real rows, never an estimate. The point is to
 * answer questions that change what gets built: are people reaching a verdict,
 * is the model contributing anything, what do they say they have, and which
 * dishes get refused.
 */

export interface DecideOverview {
  totals: {
    decisions: number;
    today: number;
    last_7_days: number;
    /** Distinct IP hashes. Repeat usage is countable; nobody is identifiable. */
    distinct_visitors: number;
    /** Decisions that produced nothing at all. The number to drive to zero. */
    empty_verdicts: number;
    /** How often the model's answer was actually used. */
    ai_framed: number;
    deterministic: number;
    median_duration_ms: number;
  };
  /** What people picked, most common first. */
  moods: { value: string; count: number }[];
  weights: { value: string; count: number }[];
  minutes: { value: number; count: number }[];
  /** The ingredients people actually say they have. */
  top_ingredients: { name: string; count: number }[];
  /** The meals we suggest most. A flat distribution here is a healthy catalogue. */
  top_verdicts: { name: string; count: number }[];
  /** The meals people refuse. The cleanest negative signal in the product. */
  top_rejected: { meal_id: string; name: string | null; count: number }[];
  cities: { name: string; count: number }[];
  /**
   * Cook versus "I'll order". Counts only decisions made since the mode
   * existed — older rows carry no mode and are left out rather than guessed.
   */
  modes: { value: string; count: number }[];
  /** Decisions per day, oldest first, for a sparkline. */
  daily: { date: string; count: number }[];
  /** How often people submit nothing at all. */
  empty_kitchen_rate: number;
}

export interface DecideLogView {
  id: string;
  request_id: string;
  visitor: string;
  kitchen_items: string[];
  kitchen_skipped: boolean;
  mood: string;
  weight: string;
  minutes: number;
  city: string | null;
  mode: string;
  place_id: string | null;
  rejected: string[];
  verdict_meal_id: string | null;
  verdict_name: string | null;
  verdict_score: number | null;
  pool_size: number;
  provenance: string;
  why: string | null;
  duration_ms: number;
  ai_fallback_reason: string | null;
  created_at: string | null;
}

const toView = (doc: DecideLogAttributes): DecideLogView => ({
  id: doc._id,
  request_id: doc.requestId,
  // The hash, shortened further for display. Enough to spot the same person
  // twice in a list; useless for anything else.
  visitor: doc.ipHash.slice(0, 8),
  kitchen_items: doc.kitchenItems,
  kitchen_skipped: doc.kitchenSkipped,
  mood: doc.mood,
  weight: doc.weight,
  minutes: doc.minutes,
  city: doc.city,
  // Rows written before order mode existed have no mode at all; they were all cooking.
  mode: doc.mode ?? 'cook',
  place_id: doc.placeId ?? null,
  rejected: doc.rejected,
  verdict_meal_id: doc.verdictMealId,
  verdict_name: doc.verdictName,
  verdict_score: doc.verdictScore,
  pool_size: doc.poolSize,
  provenance: doc.provenance,
  why: doc.why,
  duration_ms: doc.durationMs,
  ai_fallback_reason: doc.aiFallbackReason,
  created_at: isoOrNull(doc.createdAt),
});

/** Top N values of one field, as a facet. */
async function topBy(field: string, limit = 12): Promise<{ value: string; count: number }[]> {
  const rows = await DecideLogModel.aggregate<{ _id: string; count: number }>([
    { $match: { [field]: { $ne: null } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]).exec();
  return rows.map((r) => ({ value: r._id, count: r.count }));
}

/** Top N values of an ARRAY field, unwound. */
async function topInArray(field: string, limit = 15): Promise<{ name: string; count: number }[]> {
  const rows = await DecideLogModel.aggregate<{ _id: string; count: number }>([
    { $unwind: `$${field}` },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]).exec();
  return rows.map((r) => ({ name: r._id, count: r.count }));
}

export class AdminDecideService {
  private static instance: AdminDecideService | undefined;

  static getInstance(): AdminDecideService {
    AdminDecideService.instance ??= new AdminDecideService();
    return AdminDecideService.instance;
  }

  async overview(days = 14): Promise<ServiceResult<DecideOverview>> {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const [
      decisions,
      today,
      lastWeek,
      distinct,
      empty,
      aiFramed,
      emptyKitchen,
      moods,
      weights,
      minutes,
      cities,
      ingredients,
      verdicts,
      rejected,
      daily,
      durations,
      modes,
    ] = await Promise.all([
      DecideLogModel.countDocuments().exec(),
      DecideLogModel.countDocuments({ createdAt: { $gte: midnight } }).exec(),
      DecideLogModel.countDocuments({ createdAt: { $gte: weekAgo } }).exec(),
      DecideLogModel.distinct('ipHash').exec(),
      DecideLogModel.countDocuments({ verdictMealId: null }).exec(),
      DecideLogModel.countDocuments({ provenance: 'ai_framed' }).exec(),
      DecideLogModel.countDocuments({ kitchenItems: { $size: 0 } }).exec(),
      topBy('mood', 6),
      topBy('weight', 8),
      DecideLogModel.aggregate<{ _id: number; count: number }>([
        { $group: { _id: '$minutes', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).exec(),
      topBy('city', 10),
      topInArray('kitchenItems', 15),
      topInArray('verdictName', 12),
      DecideLogModel.aggregate<{ _id: string; count: number }>([
        { $unwind: '$rejected' },
        { $group: { _id: '$rejected', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).exec(),
      DecideLogModel.aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: windowStart } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]).exec(),
      // The median, not the mean: one 9-second timeout would drag an average
      // somewhere that describes no real request.
      DecideLogModel.find({}, { durationMs: 1 }).sort({ durationMs: 1 }).lean().exec(),
      topBy('mode', 4),
    ]);

    const median =
      durations.length === 0
        ? 0
        : (durations[Math.floor(durations.length / 2)]?.durationMs ?? 0);

    // Names are resolved from whatever we already logged, so a rejected meal
    // that has since been deleted still shows something useful.
    const nameById = new Map<string, string>();
    for (const row of await DecideLogModel.find(
      { verdictMealId: { $in: rejected.map((r) => r._id) } },
      { verdictMealId: 1, verdictName: 1 },
    )
      .lean()
      .exec()) {
      if (row.verdictMealId !== null && row.verdictName !== null) {
        nameById.set(row.verdictMealId, row.verdictName);
      }
    }

    return ok({
      totals: {
        decisions,
        today,
        last_7_days: lastWeek,
        distinct_visitors: distinct.length,
        empty_verdicts: empty,
        ai_framed: aiFramed,
        deterministic: decisions - aiFramed,
        median_duration_ms: median,
      },
      moods,
      weights,
      minutes: minutes.map((m) => ({ value: m._id, count: m.count })),
      top_ingredients: ingredients,
      top_verdicts: verdicts,
      top_rejected: rejected.map((r) => ({
        meal_id: r._id,
        name: nameById.get(r._id) ?? null,
        count: r.count,
      })),
      cities: cities.map((c) => ({ name: c.value, count: c.count })),
      modes,
      daily: daily.map((d) => ({ date: d._id, count: d.count })),
      empty_kitchen_rate: decisions === 0 ? 0 : emptyKitchen / decisions,
    });
  }

  /**
   * One decision, in full.
   *
   * Everything the list shows plus the parts that only matter when something
   * looks wrong: the request id, the full ingredient list, and why the model's
   * answer was not used.
   */
  async detail(id: string): Promise<ServiceResult<DecideLogView>> {
    const doc = await DecideLogModel.findById(id).lean().exec();
    if (doc === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(toView(doc as DecideLogAttributes));
  }

  /**
   * The headline figures, for the main dashboard.
   *
   * A deliberately small subset of `overview`: the dashboard answers "is
   * anything wrong", and the decide screen answers "why".
   */
  async summary(): Promise<{
    decisions: number;
    today: number;
    distinct_visitors: number;
    empty_verdicts: number;
    ai_framed: number;
    /** Empty verdicts TODAY, separately: the alert is about now, not all time. */
    empty_today: number;
    /** Yesterday's, so today can be stated as a change rather than a bare count. */
    empty_yesterday: number;
    /** Decisions in the seven days before this one, for the trend. */
    previous_week: number;
    /** Decisions in the last seven days. */
    this_week: number;
    /** How many refusals were recorded — a refused suggestion is a signal. */
    rejected: number;
    /** One count per day, oldest first, for the sparkline. */
    daily: { date: string; count: number }[];
  }> {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const yesterday = new Date(midnight.getTime() - DAY_MS);
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);
    const twoWeeksAgo = new Date(Date.now() - 14 * DAY_MS);
    const seriesFrom = new Date(midnight.getTime() - (SERIES_DAYS - 1) * DAY_MS);

    const [
      decisions,
      today,
      distinct,
      empty,
      aiFramed,
      emptyToday,
      emptyYesterday,
      thisWeek,
      previousWeek,
      rejected,
      daily,
    ] = await Promise.all([
      DecideLogModel.countDocuments().exec(),
      DecideLogModel.countDocuments({ createdAt: { $gte: midnight } }).exec(),
      DecideLogModel.distinct('ipHash').exec(),
      DecideLogModel.countDocuments({ verdictMealId: null }).exec(),
      DecideLogModel.countDocuments({ provenance: 'ai_framed' }).exec(),
      DecideLogModel.countDocuments({
        verdictMealId: null,
        createdAt: { $gte: midnight },
      }).exec(),
      DecideLogModel.countDocuments({
        verdictMealId: null,
        createdAt: { $gte: yesterday, $lt: midnight },
      }).exec(),
      DecideLogModel.countDocuments({ createdAt: { $gte: weekAgo } }).exec(),
      DecideLogModel.countDocuments({
        createdAt: { $gte: twoWeeksAgo, $lt: weekAgo },
      }).exec(),
      DecideLogModel.countDocuments({ 'rejected.0': { $exists: true } }).exec(),
      dailyCounts(DecideLogModel, seriesFrom),
    ]);

    return {
      decisions,
      today,
      distinct_visitors: distinct.length,
      empty_verdicts: empty,
      ai_framed: aiFramed,
      empty_today: emptyToday,
      empty_yesterday: emptyYesterday,
      previous_week: previousWeek,
      this_week: thisWeek,
      rejected,
      daily,
    };
  }

  /** The raw log, newest first. Every submission and every answer. */
  async list(query: {
    limit?: number;
    skip?: number;
    mood?: string;
    provenance?: string;
    /** Only the ones that produced nothing. */
    emptyOnly?: boolean;
  }): Promise<ServiceResult<{ items: DecideLogView[]; total: number }>> {
    const filter: Record<string, unknown> = {};
    if (query.mood !== undefined) filter['mood'] = query.mood;
    if (query.provenance !== undefined) filter['provenance'] = query.provenance;
    if (query.emptyOnly === true) filter['verdictMealId'] = null;

    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const skip = Math.max(query.skip ?? 0, 0);

    const [items, total] = await Promise.all([
      DecideLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      DecideLogModel.countDocuments(filter).exec(),
    ]);

    return ok({ items: items.map((d) => toView(d as DecideLogAttributes)), total });
  }
}

export const adminDecideService = AdminDecideService.getInstance();
