import type { Model } from 'mongoose';

/**
 * Time helpers shared by the console's aggregations.
 *
 * Here rather than duplicated per service so "a day" and "how long a sparkline
 * is" mean exactly one thing across the dashboard. Two services computing
 * their own idea of a week is how two numbers that should match stop matching.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days a sparkline covers. Two weeks reads as a trend; a month does not fit. */
export const SERIES_DAYS = 14;

export interface DailyCount {
  /** `YYYY-MM-DD`, in UTC. */
  date: string;
  count: number;
}

/**
 * One count per day, oldest first, with missing days filled in as zero.
 *
 * The fill matters: Mongo returns no bucket for a day nothing happened, and a
 * sparkline drawn from those rows silently closes the gap, turning a quiet
 * weekend into a straight line between the days either side of it. A zero is
 * the truth; an omitted point is a lie about the shape.
 *
 * Grouped in UTC rather than server-local time, so the series does not shift
 * when the process moves or the clocks change.
 */
export async function dailyCounts<T>(
  collection: Model<T>,
  from: Date,
  match: Record<string, unknown> = {},
): Promise<DailyCount[]> {
  const rows = await collection
    .aggregate<{ _id: string; count: number }>([
      { $match: { ...match, createdAt: { $gte: from } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
          count: { $sum: 1 },
        },
      },
    ])
    .exec();

  const found = new Map(rows.map((row) => [row._id, Number(row.count)]));

  const out: DailyCount[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const today = new Date();
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  while (cursor.getTime() <= end) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({ date: key, count: found.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return out;
}

/**
 * A period-over-period change, as a whole percent.
 *
 * `null` when the previous period was zero, NOT Infinity and not 100: going
 * from nothing to something has no meaningful percentage, and rendering
 * "▲ ∞%" or a confident "▲100%" is worse than rendering nothing. The caller
 * shows the raw count instead.
 */
export function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
