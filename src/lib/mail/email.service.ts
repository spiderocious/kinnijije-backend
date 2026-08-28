import { env } from '@app/env.js';
import { logger } from '@lib/logger/index.js';

import { EmailLogModel, type EmailKind } from './email-log.model.js';
import { EmailSettingModel } from './email-settings.model.js';
import { mailer } from './mailer.js';
import type { EmailContent } from './templates.js';

export interface SendInput {
  readonly kind: EmailKind;
  readonly to: string;
  readonly ownerId: string | null;
  readonly content: EmailContent;
  /** Set when an operator triggered it by hand. */
  readonly sentBy?: string;
  /** Set when this is a repeat of a previous send. */
  readonly resendOf?: string;
}

/**
 * The one way an email leaves this system.
 *
 * Nothing calls `mailer` directly any more — everything goes through here, so
 * that every send is RECORDED whether it worked or not. Without the log there
 * is no way to answer "did they get it?", which is the only question anybody
 * ever asks about email.
 *
 * This is not an outbox: a failure is recorded and left, not retried. That is a
 * deliberate, stated limit rather than an accident.
 */
export class EmailService {
  private static instance: EmailService | undefined;

  static getInstance(): EmailService {
    EmailService.instance ??= new EmailService();
    return EmailService.instance;
  }

  /**
   * Whether this kind is switched on.
   *
   * Absent row means ON. A new template ships enabled without a migration, and
   * turning one off is an explicit act with a row behind it.
   */
  async isKindEnabled(kind: EmailKind): Promise<boolean> {
    const setting = await EmailSettingModel.findById(kind).exec();
    return setting?.enabled !== false;
  }

  async send(input: SendInput): Promise<{ id: string; delivered: boolean }> {
    // The kill switch, checked HERE rather than at each callsite — this is the
    // only way an email leaves, so this is the only place it can be stopped.
    // The attempt is still recorded, because "why did nobody get that?" is
    // exactly the question a blocked send has to be able to answer.
    if (!(await this.isKindEnabled(input.kind))) {
      const blocked = await EmailLogModel.create({
        kind: input.kind,
        to: input.to,
        ownerId: input.ownerId,
        subject: input.content.subject,
        html: input.content.html,
        text: input.content.text,
        status: 'blocked',
        providerId: null,
        error: 'This kind of email is switched off in the console.',
        sentBy: input.sentBy ?? null,
        resendOf: input.resendOf ?? null,
      });

      logger.info('email blocked by an operator switch', { kind: input.kind, to: input.to });
      return { id: blocked._id, delivered: false };
    }

    const result = await mailer.send({
      to: input.to,
      content: input.content,
      // Everything except a password reset gets the header. A reset is a
      // response to a request somebody just made, and offering to unsubscribe
      // from it makes no sense.
      ...(input.kind !== 'password_reset' && {
        unsubscribeUrl: `${env.APP_URL.replace(/\/+$/, '')}/settings`,
      }),
    });

    // `suppressed` is its own status, not a failure: no key configured is a
    // development state, and calling it "failed" would make a dev log look
    // like an outage.
    const status = result.delivered
      ? 'sent'
      : result.reason === 'mailer_not_configured'
        ? 'suppressed'
        : 'failed';

    const row = await EmailLogModel.create({
      kind: input.kind,
      to: input.to,
      ownerId: input.ownerId,
      subject: input.content.subject,
      html: input.content.html,
      text: input.content.text,
      status,
      providerId: result.delivered ? result.id : null,
      error: result.delivered ? null : result.reason,
      sentBy: input.sentBy ?? null,
      resendOf: input.resendOf ?? null,
    });

    return { id: row._id, delivered: result.delivered };
  }

  /**
   * Fire-and-forget, for email that is a side effect of something else.
   *
   * A welcome email that bounces must not fail the registration that triggered
   * it, so the promise is handled here and no caller has to remember.
   */
  dispatch(input: SendInput): void {
    void this.send(input).catch((error: unknown) => {
      logger.error('email dispatch failed', {
        kind: input.kind,
        to: input.to,
        error: error instanceof Error ? error : String(error),
      });
    });
  }

  /**
   * Has this person had this kind of email lately?
   *
   * The frequency cap for every nudge. Spec 380's rule — "at most weekly" — is
   * enforced by callers asking this first, because a template cannot know how
   * often it has been used.
   */
  async sentWithin(ownerId: string, kind: EmailKind, hours: number): Promise<boolean> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const count = await EmailLogModel.countDocuments({
      ownerId,
      kind,
      // A suppressed send in development still counts, so local testing does
      // not produce a flood the moment a key is added.
      status: { $in: ['sent', 'suppressed'] },
      createdAt: { $gte: since },
    }).exec();

    return count > 0;
  }
}

export const emailService = EmailService.getInstance();
