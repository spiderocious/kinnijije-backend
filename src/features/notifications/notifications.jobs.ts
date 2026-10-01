import { isoOrNull } from '@lib/dates.js';
import { UserModel } from '@features/users/users.model.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import { logger } from '@lib/logger/index.js';
import {
  EMAIL_KINDS,
  emailService,
} from '@lib/mail/index.js';
import { nextRun, settingsFor } from '@lib/mail/email-policy.js';
import { USER_STATUSES } from '@shared/constants/roles.js';


export const NOTIFICATION_JOB_TYPES = {
  DAILY_SWEEP: 'notify-daily',
  WEEKLY_SWEEP: 'notify-weekly',
  /** One person, right after they cooked something down to nothing. */
  STOCK_DROPPED: 'notify-stock-dropped',
} as const;

// The schedule lives on the email setting now, so a sweep no longer owns a
// hardcoded hour — see `scheduleDailySweep`.

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

/**
 * Running low — the EVENT path, fired right after somebody cooked.
 *
 * Delegates to the shared builder rather than rendering its own copy: one
 * builder per kind is what makes the composer's preview mean something, and two
 * implementations of the same email is how they drift.
 */
async function sendRunningLow(user: { _id: string; email: string; name: string | null }) {
  const { BUILDERS } = await import('@features/admin/campaigns/email-builders.js');
  const { isEligible, settingsFor } = await import('@lib/mail/email-policy.js');

  const settings = await settingsFor(EMAIL_KINDS.LOW_STOCK);
  if (!settings.enabled) return false;

  const row = await UserModel.findById(user._id)
    .select('onboardingCompletedAt createdAt')
    .lean()
    .exec();

  const verdict = await isEligible(
    { _id: user._id, onboardingCompletedAt: row?.onboardingCompletedAt ?? null, ...(row?.createdAt !== undefined && { createdAt: row.createdAt }) },
    settings.rules,
    EMAIL_KINDS.LOW_STOCK,
    settings.minHoursBetween,
  );
  if (!verdict.eligible) return false;

  const builder = BUILDERS[EMAIL_KINDS.LOW_STOCK];
  if (builder === undefined) return false;

  const built = await builder({ _id: user._id, email: user.email, name: user.name });
  if (built === null) return false;

  await emailService.send({
    kind: EMAIL_KINDS.LOW_STOCK,
    to: user.email,
    ownerId: user._id,
    content: built.content,
  });

  return true;
}

/**
 * Somebody just cooked, and something ran out doing it.
 *
 * Queued from `markCooked` rather than sent there: cooking should not wait on
 * an email, and the stock write has to land before we can see what it did.
 *
 * The same weekly cap applies. Cooking three meals on a Sunday must not produce
 * three emails, and the cap is what stops it.
 */
async function runStockDropped(payload: unknown): Promise<unknown> {
  const { ownerId } = payload as { ownerId: string };

  const user = await UserModel.findById(ownerId).select('_id email name notifications status').exec();
  if (user === null) return { skipped: 'no such person' };
  if (!user.notifications.runningLow) return { skipped: 'not subscribed' };
  if (![USER_STATUSES.ACTIVE, USER_STATUSES.PENDING].includes(user.status as never)) {
    return { skipped: 'account not receiving email' };
  }

  const sent = await sendRunningLow({ _id: user._id, email: user.email, name: user.name });
  return { sent };
}

/**
 * Ask for that email. Called by whatever changed the stock.
 *
 * Silent when nothing is due — every gate lives in the job, so callers do not
 * have to know any of the rules.
 */
export async function notifyStockDropped(ownerId: string): Promise<void> {
  await jobQueue.enqueue({
    type: NOTIFICATION_JOB_TYPES.STOCK_DROPPED,
    ownerId,
    payload: { ownerId },
    maxAttempts: 1,
  });
}

/**
 * The daily sweep now DRAFTS rather than sends.
 *
 * Every kind goes through `campaignsService.draftSweep`, which applies the
 * eligibility floor, builds one draft per qualifying person, and either waits
 * for review or sends immediately when the kind is set to `autoApprove`.
 *
 * `use_it_up` is included here for the first time. It had a template, a user
 * preference, a settings toggle and an opt-out — and nothing ever sent it, so
 * people were toggling a preference that did nothing.
 */
async function runDailySweep(): Promise<unknown> {
  const { campaignsService } = await import('@features/admin/campaigns/campaigns.service.js');

  const results: Record<string, unknown> = {};
  for (const kind of [
    EMAIL_KINDS.DAILY_DIGEST,
    EMAIL_KINDS.LOW_STOCK,
    EMAIL_KINDS.USE_IT_UP,
    EMAIL_KINDS.HAVE_YOU_EATEN,
  ]) {
    const result = await campaignsService.draftSweep(kind);
    results[kind] = result.success ? result.data : { skipped: result.rejectionReason };
  }

  // Re-queue tomorrow BEFORE returning, so a sweep that finishes always leaves
  // its successor behind. A missed re-queue means email silently stops.
  await scheduleDailySweep();

  logger.info('daily notification sweep finished', results);
  return results;
}

/**
 * The weekly sweep: the summary, and the empty-kitchen segment.
 *
 * `empty_kitchen` runs weekly rather than daily because it nags easily — its
 * own rule caps it at one a week per person on top of this.
 */
async function runWeeklySweep(): Promise<unknown> {
  const { campaignsService } = await import('@features/admin/campaigns/campaigns.service.js');

  const results: Record<string, unknown> = {};
  for (const kind of [EMAIL_KINDS.WEEKLY_SUMMARY, EMAIL_KINDS.EMPTY_KITCHEN]) {
    const result = await campaignsService.draftSweep(kind);
    results[kind] = result.success ? result.data : { skipped: result.rejectionReason };
  }

  await scheduleWeeklySweep();

  logger.info('weekly notification sweep finished', results);
  return results;
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
  logger.info('notification sweep scheduled', { type, run_at: isoOrNull(runAt) });
}

/**
 * The next daily run, from the DAILY_DIGEST setting.
 *
 * Reading it from the setting rather than a constant is what lets an operator
 * move the send time without a deploy — and `nextRun` computes it in the
 * setting's own timezone, which is the bug that made "07:00" mean 07:00 on the
 * server.
 */
export async function scheduleDailySweep(): Promise<void> {
  const settings = await settingsFor(EMAIL_KINDS.DAILY_DIGEST);
  await scheduleSweep(NOTIFICATION_JOB_TYPES.DAILY_SWEEP, nextRun(settings.schedule));
}

export async function scheduleWeeklySweep(): Promise<void> {
  const settings = await settingsFor(EMAIL_KINDS.WEEKLY_SUMMARY);
  await scheduleSweep(NOTIFICATION_JOB_TYPES.WEEKLY_SWEEP, nextRun(settings.schedule));
}

export function registerNotificationHandlers(): void {
  jobQueue.register(NOTIFICATION_JOB_TYPES.DAILY_SWEEP, runDailySweep);
  jobQueue.register(NOTIFICATION_JOB_TYPES.WEEKLY_SWEEP, runWeeklySweep);
  jobQueue.register(NOTIFICATION_JOB_TYPES.STOCK_DROPPED, runStockDropped);
}
