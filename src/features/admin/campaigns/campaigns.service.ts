import { UserModel } from '@features/users/users.model.js';
import { record } from '@lib/audit/index.js';
import { isoOrNull } from '@lib/dates.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { EMAIL_KINDS, EmailLogModel, type EmailKind } from '@lib/mail/email-log.model.js';
import { isEligible, settingsFor } from '@lib/mail/email-policy.js';
import { emailService } from '@lib/mail/email.service.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';
import { USER_STATUSES } from '@shared/constants/roles.js';

import { BATCH_SOURCES, BATCH_STATUSES, EmailBatchModel } from './email-batch.model.js';
import { DRAFT_STATUSES, EmailDraftModel } from './email-draft.model.js';
import { BUILDERS, hashBody } from './email-builders.js';

/**
 * Drafting, reviewing and sending a batch.
 *
 * The sweep no longer sends. It drafts here, and a person approves — which is
 * the whole point: four hundred identical emails look like four hundred fine
 * emails until somebody can see them side by side.
 */

const PREF_BY_KIND: Partial<Record<EmailKind, string>> = {
  [EMAIL_KINDS.DAILY_DIGEST]: 'dailyDigest',
  [EMAIL_KINDS.LOW_STOCK]: 'runningLow',
  [EMAIL_KINDS.WEEKLY_SUMMARY]: 'weeklySummary',
  [EMAIL_KINDS.USE_IT_UP]: 'useItUp',
  [EMAIL_KINDS.HAVE_YOU_EATEN]: 'haveYouEaten',
  // No preference of its own — it rides on the digest opt-in, because a second
  // toggle for "tell me when my kitchen is empty" is a setting nobody reads.
  [EMAIL_KINDS.EMPTY_KITCHEN]: 'dailyDigest',
};

export class CampaignsService {
  private static instance: CampaignsService | undefined;

  static getInstance(): CampaignsService {
    CampaignsService.instance ??= new CampaignsService();
    return CampaignsService.instance;
  }

  /**
   * Drafts one kind for everybody who qualifies.
   *
   * Called by the sweep. Returns the batch, which is either waiting for review
   * or — when the kind is set to `autoApprove` — already queued to send.
   */
  async draftSweep(kind: EmailKind): Promise<ServiceResult<{ batchId: string; drafted: number }>> {
    const builder = BUILDERS[kind];
    if (builder === undefined) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.UNPROCESSABLE, {
        rejectionReason: 'kind_has_no_builder',
      });
    }

    const settings = await settingsFor(kind);
    if (!settings.enabled) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.UNPROCESSABLE, {
        rejectionReason: 'kind_disabled',
      });
    }

    const prefField = PREF_BY_KIND[kind];
    const audience = await UserModel.find({
      ...(prefField !== undefined && { [`notifications.${prefField}`]: true }),
      // A suspended or banned account gets no product email. Pending does —
      // they signed up, they just have not verified.
      status: { $in: [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] },
    })
      .select('_id email name city prefs onboardingCompletedAt createdAt')
      .lean()
      .exec();

    const batch = await EmailBatchModel.create({
      kind,
      status: BATCH_STATUSES.DRAFTING,
      source: BATCH_SOURCES.SWEEP,
      scheduledFor: new Date(),
    });

    const skipReasons: Record<string, number> = {};
    let drafted = 0;

    for (const user of audience) {
      try {
        const verdict = await isEligible(user, settings.rules, kind, settings.minHoursBetween);
        if (!verdict.eligible) {
          skipReasons[verdict.reason] = (skipReasons[verdict.reason] ?? 0) + 1;
          continue;
        }

        const built = await builder(user);
        if (built === null) {
          skipReasons['nothing_to_say'] = (skipReasons['nothing_to_say'] ?? 0) + 1;
          continue;
        }

        await EmailDraftModel.create({
          batchId: batch._id,
          ownerId: user._id,
          email: user.email,
          name: user.name,
          subject: built.content.subject,
          html: built.content.html,
          text: built.content.text,
          inputs: built.inputs,
          bodyHash: hashBody(built.content.text),
        });
        drafted += 1;
      } catch (error) {
        // Stepped over. One broken account must not end the run — the same
        // rule the old sweep had, kept.
        skipReasons['build_failed'] = (skipReasons['build_failed'] ?? 0) + 1;
        logger.error('draft failed for one person', {
          kind,
          user_id: user._id,
          error: error instanceof Error ? error : String(error),
        });
      }
    }

    const skipped = Object.values(skipReasons).reduce((sum, n) => sum + n, 0);

    batch.status = settings.autoApprove ? BATCH_STATUSES.APPROVED : BATCH_STATUSES.PENDING_REVIEW;
    batch.draftCount = drafted;
    batch.excludedCount = skipped;
    batch.skipReasons = skipReasons;
    if (settings.autoApprove) batch.approvedAt = new Date();
    await batch.save();

    logger.info('email batch drafted', {
      kind,
      batch_id: batch._id,
      drafted,
      skipped,
      auto_approve: settings.autoApprove,
    });

    // `autoApprove` reproduces the old send-immediately behaviour, so a kind
    // that is trustworthy is not gated on a human forever.
    if (settings.autoApprove) await this.send(batch._id);

    return ok({ batchId: batch._id, drafted });
  }

  /**
   * Drafts for NAMED users — the composer.
   *
   * Eligibility is reported but NOT enforced: the point of previewing an
   * ineligible user is to see what they would have got.
   */
  async draftForUsers(
    kind: EmailKind,
    userIds: readonly string[],
    actor: { id: string; email: string; tier: string },
  ): Promise<ServiceResult<{ batchId: string; drafted: number; skipped: Record<string, number> }>> {
    const builder = BUILDERS[kind];
    if (builder === undefined) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.UNPROCESSABLE, {
        rejectionReason: 'kind_has_no_builder',
      });
    }

    const users = await UserModel.find({ _id: { $in: userIds } })
      .select('_id email name city prefs onboardingCompletedAt createdAt')
      .lean()
      .exec();

    if (users.length === 0) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const batch = await EmailBatchModel.create({
      kind,
      status: BATCH_STATUSES.DRAFTING,
      source: BATCH_SOURCES.COMPOSER,
      scheduledFor: new Date(),
    });

    const skipReasons: Record<string, number> = {};
    let drafted = 0;

    for (const user of users) {
      try {
        const built = await builder(user);
        if (built === null) {
          skipReasons['nothing_to_say'] = (skipReasons['nothing_to_say'] ?? 0) + 1;
          continue;
        }

        await EmailDraftModel.create({
          batchId: batch._id,
          ownerId: user._id,
          email: user.email,
          name: user.name,
          subject: built.content.subject,
          html: built.content.html,
          text: built.content.text,
          inputs: built.inputs,
          bodyHash: hashBody(built.content.text),
        });
        drafted += 1;
      } catch (error) {
        skipReasons['build_failed'] = (skipReasons['build_failed'] ?? 0) + 1;
        logger.error('composer draft failed', {
          kind,
          user_id: user._id,
          error: error instanceof Error ? error : String(error),
        });
      }
    }

    batch.status = BATCH_STATUSES.PENDING_REVIEW;
    batch.draftCount = drafted;
    batch.skipReasons = skipReasons;
    await batch.save();

    record({
      action: 'emails.composed',
      resource: 'emails',
      resourceId: batch._id,
      meta: { kind, requested: users.length, drafted },
      actor: { id: actor.id, email: actor.email, role: actor.tier },
    });

    return ok({ batchId: batch._id, drafted, skipped: skipReasons });
  }

  /** One batch, with its drafts grouped so duplicates are visible. */
  async batch(batchId: string): Promise<ServiceResult<unknown>> {
    const batch = await EmailBatchModel.findById(batchId).lean().exec();
    if (batch === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const drafts = await EmailDraftModel.find({ batchId }).sort({ createdAt: 1 }).lean().exec();

    /**
     * How many drafts share each body.
     *
     * THE POINT of the review screen: a group of 400 identical bodies is the
     * repetition bug, made visible. Sorted so the biggest group leads.
     */
    const byHash = new Map<string, number>();
    for (const draft of drafts) {
      byHash.set(draft.bodyHash, (byHash.get(draft.bodyHash) ?? 0) + 1);
    }
    const duplicateGroups = [...byHash.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([hash, count]) => ({ body_hash: hash, count }));

    return ok({
      id: batch._id,
      kind: batch.kind,
      status: batch.status,
      source: batch.source,
      scheduled_for: isoOrNull(batch.scheduledFor),
      draft_count: batch.draftCount,
      excluded_count: batch.excludedCount,
      edited_count: batch.editedCount,
      sent_count: batch.sentCount,
      failed_count: batch.failedCount,
      skip_reasons: batch.skipReasons,
      approved_by: batch.approvedBy,
      approved_at: isoOrNull(batch.approvedAt),
      created_at: isoOrNull(batch.createdAt),
      /** Biggest group first — identical copy is what you are looking for. */
      duplicate_groups: duplicateGroups,
      drafts: drafts.map((draft) => ({
        id: draft._id,
        owner_id: draft.ownerId,
        email: draft.email,
        name: draft.name,
        subject: draft.subject,
        html: draft.html,
        text: draft.text,
        inputs: draft.inputs,
        body_hash: draft.bodyHash,
        /** True when somebody else in this batch is getting the same words. */
        is_duplicate: (byHash.get(draft.bodyHash) ?? 0) > 1,
        status: draft.status,
        excluded_reason: draft.excludedReason,
        error: draft.error,
      })),
    });
  }

  async list(filter: { kind?: string; status?: string; limit?: number }): Promise<ServiceResult<unknown[]>> {
    const query: Record<string, unknown> = {};
    if (filter.kind !== undefined) query['kind'] = filter.kind;
    if (filter.status !== undefined) query['status'] = filter.status;

    const batches = await EmailBatchModel.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(filter.limit ?? 40, 100))
      .lean()
      .exec();

    return ok(
      batches.map((batch) => ({
        id: batch._id,
        kind: batch.kind,
        status: batch.status,
        source: batch.source,
        draft_count: batch.draftCount,
        excluded_count: batch.excludedCount,
        edited_count: batch.editedCount,
        sent_count: batch.sentCount,
        failed_count: batch.failedCount,
        skip_reasons: batch.skipReasons,
        scheduled_for: isoOrNull(batch.scheduledFor),
        created_at: isoOrNull(batch.createdAt),
      })),
    );
  }

  /** Edit one person's copy. Recorded against the editor. */
  async editDraft(
    draftId: string,
    changes: { subject?: string; text?: string; html?: string },
    actor: { id: string; email: string; tier: string },
  ): Promise<ServiceResult<null>> {
    const draft = await EmailDraftModel.findById(draftId).exec();
    if (draft === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    if (draft.status === DRAFT_STATUSES.SENT) {
      return fail(ERROR_CODES.ALREADY_EXISTS, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.CONFLICT, {
        rejectionReason: 'already_sent',
      });
    }

    const before = { subject: draft.subject, text: draft.text };

    if (changes.subject !== undefined) draft.subject = changes.subject;
    if (changes.text !== undefined) draft.text = changes.text;
    if (changes.html !== undefined) draft.html = changes.html;
    // Re-hashed, so an edited draft stops being grouped with the copies it no
    // longer matches.
    draft.bodyHash = hashBody(draft.text);
    draft.status = DRAFT_STATUSES.EDITED;
    draft.editedBy = actor.id;
    await draft.save();

    await EmailBatchModel.updateOne({ _id: draft.batchId }, { $inc: { editedCount: 1 } }).exec();

    record({
      action: 'emails.draft.edited',
      resource: 'emails',
      resourceId: draftId,
      changes: [
        { field: 'subject', from: before.subject, to: draft.subject },
        { field: 'text', from: `${before.text.slice(0, 80)}…`, to: `${draft.text.slice(0, 80)}…` },
      ],
      actor: { id: actor.id, email: actor.email, role: actor.tier },
    });

    return ok(null);
  }

  /** Pull one person out of the batch. */
  async excludeDraft(
    draftId: string,
    reason: string | null,
    actor: { id: string; email: string; tier: string },
  ): Promise<ServiceResult<null>> {
    const draft = await EmailDraftModel.findById(draftId).exec();
    if (draft === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    if (draft.status === DRAFT_STATUSES.SENT) {
      return fail(ERROR_CODES.ALREADY_EXISTS, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.CONFLICT, {
        rejectionReason: 'already_sent',
      });
    }

    draft.status = DRAFT_STATUSES.EXCLUDED;
    draft.excludedReason = reason ?? 'excluded by reviewer';
    await draft.save();

    await EmailBatchModel.updateOne(
      { _id: draft.batchId },
      { $inc: { draftCount: -1, excludedCount: 1 } },
    ).exec();

    record({
      action: 'emails.draft.excluded',
      resource: 'emails',
      resourceId: draftId,
      meta: { reason, owner_id: draft.ownerId },
      actor: { id: actor.id, email: actor.email, role: actor.tier },
    });

    return ok(null);
  }

  async approve(
    batchId: string,
    actor: { id: string; email: string; tier: string },
  ): Promise<ServiceResult<{ queued: number }>> {
    const batch = await EmailBatchModel.findById(batchId).exec();
    if (batch === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    if (batch.status !== BATCH_STATUSES.PENDING_REVIEW) {
      return fail(ERROR_CODES.ALREADY_EXISTS, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.CONFLICT, {
        rejectionReason: `batch_is_${batch.status}`,
      });
    }

    batch.status = BATCH_STATUSES.APPROVED;
    batch.approvedBy = actor.id;
    batch.approvedAt = new Date();
    await batch.save();

    record({
      action: 'emails.batch.approved',
      resource: 'emails',
      resourceId: batchId,
      meta: { kind: batch.kind, drafts: batch.draftCount },
      actor: { id: actor.id, email: actor.email, role: actor.tier },
    });

    const result = await this.send(batchId);
    return ok({ queued: result });
  }

  async discard(
    batchId: string,
    actor: { id: string; email: string; tier: string },
  ): Promise<ServiceResult<null>> {
    const batch = await EmailBatchModel.findById(batchId).exec();
    if (batch === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    if (batch.status === BATCH_STATUSES.SENT || batch.status === BATCH_STATUSES.SENDING) {
      return fail(ERROR_CODES.ALREADY_EXISTS, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.CONFLICT, {
        rejectionReason: `batch_is_${batch.status}`,
      });
    }

    batch.status = BATCH_STATUSES.DISCARDED;
    await batch.save();

    record({
      action: 'emails.batch.discarded',
      resource: 'emails',
      resourceId: batchId,
      meta: { kind: batch.kind, drafts: batch.draftCount },
      actor: { id: actor.id, email: actor.email, role: actor.tier },
    });

    return ok(null);
  }

  /**
   * Sends every unsent draft in an approved batch.
   *
   * Through `emailService.send`, deliberately — so `email_logs`, the per-kind
   * kill switch and the unsubscribe header all keep working. The pipeline adds
   * review; it does not replace the mailer.
   */
  async send(batchId: string): Promise<number> {
    const batch = await EmailBatchModel.findById(batchId).exec();
    if (batch === null) return 0;

    batch.status = BATCH_STATUSES.SENDING;
    await batch.save();

    const drafts = await EmailDraftModel.find({
      batchId,
      status: { $in: [DRAFT_STATUSES.DRAFT, DRAFT_STATUSES.EDITED] },
    }).exec();

    let sent = 0;
    let failed = 0;

    for (const draft of drafts) {
      try {
        const result = await emailService.send({
          kind: batch.kind,
          to: draft.email,
          ownerId: draft.ownerId,
          // The STORED copy, not a re-render: an operator may have edited it,
          // and re-rendering would silently discard the edit.
          content: { subject: draft.subject, html: draft.html, text: draft.text },
        });

        draft.status = result.delivered ? DRAFT_STATUSES.SENT : DRAFT_STATUSES.FAILED;
        draft.emailLogId = result.id;
        draft.error = result.error;
        await draft.save();

        if (result.delivered) sent += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        draft.status = DRAFT_STATUSES.FAILED;
        draft.error = error instanceof Error ? error.message : String(error);
        await draft.save();
      }
    }

    batch.status = BATCH_STATUSES.SENT;
    batch.sentCount = sent;
    batch.failedCount = failed;
    await batch.save();

    logger.info('email batch sent', { batch_id: batchId, kind: batch.kind, sent, failed });
    return sent;
  }

  /**
   * Operator settings for one kind.
   *
   * Upserted, because absence means "never touched" and the shipped defaults
   * supply the rest — a kind ships configured without a migration.
   *
   * The timezone is validated against `Intl` rather than trusted: a typo there
   * silently moves every send of that kind to UTC, which is exactly the class
   * of bug this whole section exists to fix.
   */
  async updateSettings(
    kind: EmailKind,
    patch: {
      enabled?: boolean;
      autoApprove?: boolean;
      schedule?: { hour: number; minute: number; dayOfWeek: number | null; timezone: string };
      rules?: Record<string, unknown>;
      minHoursBetween?: number | null;
      reason?: string;
    },
    actor: { id: string; email: string; tier: string },
  ): Promise<ServiceResult<null>> {
    if (patch.schedule !== undefined) {
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: patch.schedule.timezone });
      } catch {
        return fail(
          ERROR_CODES.VALIDATION_ERROR,
          MESSAGE_KEYS.common.VALIDATION_ERROR,
          HTTP_STATUS.UNPROCESSABLE,
          {
            fieldErrors: { timezone: [`'${patch.schedule.timezone}' is not a known timezone`] },
            rejectionReason: 'unknown_timezone',
          },
        );
      }
    }

    const { EmailSettingModel } = await import('@lib/mail/email-settings.model.js');
    const before = await settingsFor(kind);

    const update: Record<string, unknown> = { updatedBy: actor.id };
    if (patch.enabled !== undefined) update['enabled'] = patch.enabled;
    if (patch.autoApprove !== undefined) update['autoApprove'] = patch.autoApprove;
    if (patch.schedule !== undefined) update['schedule'] = patch.schedule;
    if (patch.rules !== undefined) update['rules'] = patch.rules;
    if (patch.minHoursBetween !== undefined) update['minHoursBetween'] = patch.minHoursBetween;
    if (patch.reason !== undefined) update['reason'] = patch.reason;

    await EmailSettingModel.findByIdAndUpdate(kind, { $set: update }, { upsert: true }).exec();

    const after = await settingsFor(kind);

    record({
      action: 'emails.settings.changed',
      resource: 'emails',
      resourceId: kind,
      changes: [
        { field: 'enabled', from: before.enabled, to: after.enabled },
        { field: 'autoApprove', from: before.autoApprove, to: after.autoApprove },
        { field: 'schedule', from: before.schedule, to: after.schedule },
        { field: 'rules', from: before.rules, to: after.rules },
      ],
      meta: patch.reason === undefined ? null : { reason: patch.reason },
      actor: { id: actor.id, email: actor.email, role: actor.tier },
    });

    logger.info('email settings changed', { kind, by: actor.id });
    return ok(null);
  }

  /**
   * The domain dashboard: what every kind is doing.
   *
   * Reads settings, recent batches and the send log so one screen answers "is
   * this working" without opening four others.
   */
  async overview(): Promise<ServiceResult<unknown>> {
    const { nextRun } = await import('@lib/mail/email-policy.js');
    const kinds = Object.keys(BUILDERS) as EmailKind[];

    const rows = await Promise.all(
      kinds.map(async (kind) => {
        const settings = await settingsFor(kind);
        const [lastBatch, pending, sentCount, optedIn] = await Promise.all([
          EmailBatchModel.findOne({ kind }).sort({ createdAt: -1 }).lean().exec(),
          EmailBatchModel.countDocuments({ kind, status: BATCH_STATUSES.PENDING_REVIEW }).exec(),
          EmailLogModel.countDocuments({ kind, status: 'sent' }).exec(),
          (async () => {
            const field = PREF_BY_KIND[kind];
            if (field === undefined) return 0;
            return UserModel.countDocuments({ [`notifications.${field}`]: true }).exec();
          })(),
        ]);

        return {
          kind,
          enabled: settings.enabled,
          auto_approve: settings.autoApprove,
          schedule: settings.schedule,
          rules: settings.rules,
          min_hours_between: settings.minHoursBetween,
          next_run: nextRun(settings.schedule).toISOString(),
          opted_in: optedIn,
          sent_all_time: sentCount,
          pending_review: pending,
          last_batch:
            lastBatch === null
              ? null
              : {
                  id: lastBatch._id,
                  status: lastBatch.status,
                  drafted: lastBatch.draftCount,
                  sent: lastBatch.sentCount,
                  failed: lastBatch.failedCount,
                  skip_reasons: lastBatch.skipReasons,
                  created_at: isoOrNull(lastBatch.createdAt),
                },
        };
      }),
    );

    return ok({ kinds: rows });
  }
}

export const campaignsService = CampaignsService.getInstance();
