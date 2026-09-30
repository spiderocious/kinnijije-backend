import { DecideHistoryModel } from './decide-history.model.js';

/**
 * A cook's own past decisions.
 *
 * Owner-scoped at the QUERY, never filtered after the fact: `ownerId` is in
 * the `find` itself, so a bug in presentation cannot leak another person's
 * rows. The route is authenticated and the id comes from the token, never
 * from the request.
 */

/** How many rows a cook can look back through. */
const HISTORY_LIMIT = 30;

export interface DecideHistoryEntry {
  id: string;
  created_at: string;
  /** The answers, in the shape the flow uses, so it can be replayed. */
  answers: {
    kitchen_items: string[];
    kitchen_skipped: boolean;
    mood: string;
    weight: string;
    minutes: number;
    city: string | null;
    mode: string;
  };
  verdict: {
    meal_id: string | null;
    name: string | null;
    score: number | null;
    why: string | null;
  };
  /** How many runners-up were shown alongside it. */
  pool_count: number;
}

/** One row as the client sees it. Shared so `list` and `get` cannot drift. */
function toEntry(row: {
  _id: string;
  createdAt: Date;
  kitchenItems: string[];
  kitchenSkipped: boolean;
  mood: string;
  weight: string;
  minutes: number;
  city: string | null;
  mode: string;
  verdictMealId: string | null;
  verdictName: string | null;
  verdictScore: number | null;
  why: string | null;
  poolMealIds: string[];
}): DecideHistoryEntry {
  return {
    id: row._id,
    created_at: row.createdAt.toISOString(),
    answers: {
      kitchen_items: row.kitchenItems,
      kitchen_skipped: row.kitchenSkipped,
      mood: row.mood,
      weight: row.weight,
      minutes: row.minutes,
      city: row.city,
      mode: row.mode,
    },
    verdict: {
      meal_id: row.verdictMealId,
      name: row.verdictName,
      score: row.verdictScore,
      why: row.why,
    },
    pool_count: row.poolMealIds.length,
  };
}

export const decideHistoryService = {
  /** Newest first. Capped: this is a glance backwards, not an archive. */
  async list(ownerId: string, limit = HISTORY_LIMIT): Promise<DecideHistoryEntry[]> {
    const rows = await DecideHistoryModel.find({ ownerId })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, HISTORY_LIMIT))
      .lean()
      .exec();

    return rows.map(toEntry);
  },

  /**
   * One row, scoped to its owner.
   *
   * The owner is part of the query rather than checked afterwards, so a
   * guessed id belonging to somebody else returns null instead of their meal.
   */
  async get(ownerId: string, id: string): Promise<DecideHistoryEntry | null> {
    const row = await DecideHistoryModel.findOne({ _id: id, ownerId }).lean().exec();
    if (row === null) return null;
    return toEntry(row);
  },

  /** Removing one. Owner-scoped for the same reason `get` is. */
  async remove(ownerId: string, id: string): Promise<boolean> {
    const result = await DecideHistoryModel.deleteOne({ _id: id, ownerId }).exec();
    return result.deletedCount > 0;
  },
};
