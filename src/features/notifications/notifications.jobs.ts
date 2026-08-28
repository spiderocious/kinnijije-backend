import { mealsService } from '@features/meals/meals.service.js';
import { insightsService } from '@features/insights/insights.service.js';
import { stockService } from '@features/stock/stock.service.js';
import { UserModel } from '@features/users/users.model.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import { logger } from '@lib/logger/index.js';
import {
  dailyDigestEmail,
  EMAIL_KINDS,
  emailService,
  lowStockEmail,
  weeklySummaryEmail,
} from '@lib/mail/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';

export const NOTIFICATION_JOB_TYPES = {
  DAILY_SWEEP: 'notify-daily',
  WEEKLY_SWEEP: 'notify-weekly',
} as const;

/** A day and a week, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Scheduled email.
 *
 * Two SWEEP jobs — one daily, one weekly — walk everybody who opted in and send
 * what applies. Each sweep re-queues itself for the next run, which is how the
 * queue carries recurring work without a cron: `runAt` holds the next one until
 * its moment.
 *
 * A sweep never throws for one person's sake. One account with broken data must
 * not stop the other nine hundred from getting their email.
 */

/** Everybody who has this preference on and is allowed to receive anything. */
async function subscribers(field: string) {
  return UserModel.find({
    [`notifications.${field}`]: true,
    // A suspended or banned account does not get product email. A pending one
    // does — they signed up, they just have not verified.
    status: { $in: [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] },
  })
    .select('_id email name')
    .exec();
}

/**
 * The morning note: what is in, what to cook, what is turning.
 *
 * Sent only when there is something to say. An empty kitchen produces an email
 * that reads "you have 0 things and can cook nothing", which is worse than
 * silence.
 */
async function sendDailyDigest(user: { _id: string; email: string; name: string | null }) {
  const [dashboard, suggestions] = await Promise.all([
    // The second argument is the could-make count the dashboard reports.
    stockService.dashboard(user._id, 3),
    mealsService.suggest(user._id, 3),
  ]);

  if (!dashboard.success) return false;

  const counts = dashboard.data.counts;
  const meals = suggestions.success ? suggestions.data : [];

  // Nothing in the kitchen and nothing to cook — say nothing.
  if (counts.things_in === 0 && meals.length === 0) return false;

  const expiring = dashboard.data.use_first
    .filter((item) => item.days_left !== null && item.days_left <= 3)
    .slice(0, 5)
    .map((item) => ({ name: item.name, daysLeft: item.days_left ?? 0 }));

  await emailService.send({
    kind: EMAIL_KINDS.DAILY_DIGEST,
    to: user.email,
    ownerId: user._id,
    content: dailyDigestEmail(user.name, {
      thingsIn: counts.things_in,
      meals: meals.slice(0, 3).map((suggestion) => ({
        id: suggestion.meal.id,
        name: suggestion.meal.name,
        missing: suggestion.missing.length,
      })),
      expiring,
      runningLow: dashboard.data.running_low.slice(0, 4).map((item) => item.name),
    }),
  });

  return true;
}

/**
 * Running low.
 *
 * Spec 380's rule is the important part: at most weekly, and only when it is
 * genuinely blocking something. The frequency cap is asked of the email log,
 * because a template cannot know how often it has been used.
 */
async function sendRunningLow(user: { _id: string; email: string; name: string | null }) {
  if (await emailService.sentWithin(user._id, EMAIL_KINDS.LOW_STOCK, 7 * 24)) return false;

  const dashboard = await stockService.dashboard(user._id, 5);
  if (!dashboard.success || dashboard.data.running_low.length === 0) return false;

  // What these are actually blocking. Without this the email is a list of
  // groceries with no reason to care, which is the failure the spec names.
  const suggestions = await mealsService.suggest(user._id, 5);
  const lowNames = new Set(dashboard.data.running_low.map((item) => item.name.toLowerCase()));

  const blocking = suggestions.success
    ? suggestions.data
        .filter((suggestion) =>
          suggestion.missing.some((missing) => lowNames.has(missing.toLowerCase())),
        )
        .slice(0, 3)
        .map((suggestion) => suggestion.meal.name)
    : [];

  // Nothing it blocks is worth nobody's inbox.
  if (blocking.length === 0) return false;

  await emailService.send({
    kind: EMAIL_KINDS.LOW_STOCK,
    to: user.email,
    ownerId: user._id,
    content: lowStockEmail(
      user.name,
      dashboard.data.running_low.slice(0, 5).map((item) => ({
        name: item.name,
        reason: item.reason,
      })),
      blocking,
    ),
  });

  return true;
}

/** Spec 382: descriptive, never a scorecard. */
async function sendWeeklySummary(user: { _id: string; email: string; name: string | null }) {
  const summary = await insightsService.weekSummary(user._id);
  if (!summary.success) return false;

  const week = summary.data as {
    total_meals: number;
    meals?: { name: string }[];
    reading?: { headline?: string } | null;
    estimated_spend?: number | null;
  };

  await emailService.send({
    kind: EMAIL_KINDS.WEEKLY_SUMMARY,
    to: user.email,
    ownerId: user._id,
    content: weeklySummaryEmail(user.name, {
      cooked: week.total_meals,
      meals: (week.meals ?? []).slice(0, 6).map((meal) => meal.name),
      reading: week.reading?.headline ?? null,
      spent: week.estimated_spend ?? null,
    }),
  });

  return true;
}

/** Runs one send per person, swallowing per-person failure. */
async function sweep(
  label: string,
  users: readonly { _id: string; email: string; name: string | null }[],
  send: (user: { _id: string; email: string; name: string | null }) => Promise<boolean>,
): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    try {
      if (await send(user)) sent += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      // Logged and stepped over. One broken account must not end the sweep.
      logger.error('notification sweep failed for one person', {
        sweep: label,
        user_id: user._id,
        error: error instanceof Error ? error : String(error),
      });
    }
  }

  return { sent, skipped, failed };
}

async function runDailySweep(): Promise<unknown> {
  const [digestUsers, lowUsers] = await Promise.all([
    subscribers('dailyDigest'),
    subscribers('runningLow'),
  ]);

  const digest = await sweep('daily_digest', digestUsers, sendDailyDigest);
  const low = await sweep('running_low', lowUsers, sendRunningLow);

  // Re-queue tomorrow BEFORE returning, so a sweep that finishes always leaves
  // its successor behind. A missed re-queue means email silently stops.
  await scheduleDailySweep();

  logger.info('daily notification sweep finished', { digest, low });
  return { digest, low };
}

async function runWeeklySweep(): Promise<unknown> {
  const users = await subscribers('weeklySummary');
  const result = await sweep('weekly_summary', users, sendWeeklySummary);

  await scheduleWeeklySweep();

  logger.info('weekly notification sweep finished', { result });
  return result;
}

/** Tomorrow at 07:00 local — a digest is a morning thing. */
function nextMorning(): Date {
  const next = new Date();
  next.setHours(7, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setTime(next.getTime() + DAY_MS);
  return next;
}

/** The coming Sunday at 18:00 — the week is over and the evening is quiet. */
function nextSundayEvening(): Date {
  const next = new Date();
  next.setHours(18, 0, 0, 0);
  const daysUntilSunday = (7 - next.getDay()) % 7;
  next.setTime(next.getTime() + daysUntilSunday * DAY_MS);
  if (next.getTime() <= Date.now()) next.setTime(next.getTime() + 7 * DAY_MS);
  return next;
}

/**
 * Queue the next sweep, unless one is already waiting.
 *
 * The guard is what makes this safe to call at boot: restarting the server five
 * times must not produce five daily digests.
 */
async function scheduleSweep(type: string, runAt: Date): Promise<void> {
  const { JobModel } = await import('@lib/jobs/jobs.model.js');
  const pending = await JobModel.countDocuments({ type, status: 'queued' }).exec();
  if (pending > 0) return;

  await jobQueue.enqueue({ type, ownerId: 'system', payload: {}, runAt, maxAttempts: 1 });
  logger.info('notification sweep scheduled', { type, run_at: runAt.toISOString() });
}

export async function scheduleDailySweep(): Promise<void> {
  await scheduleSweep(NOTIFICATION_JOB_TYPES.DAILY_SWEEP, nextMorning());
}

export async function scheduleWeeklySweep(): Promise<void> {
  await scheduleSweep(NOTIFICATION_JOB_TYPES.WEEKLY_SWEEP, nextSundayEvening());
}

export function registerNotificationHandlers(): void {
  jobQueue.register(NOTIFICATION_JOB_TYPES.DAILY_SWEEP, runDailySweep);
  jobQueue.register(NOTIFICATION_JOB_TYPES.WEEKLY_SWEEP, runWeeklySweep);
}
