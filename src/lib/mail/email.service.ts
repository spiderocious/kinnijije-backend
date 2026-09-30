import { env, IS_PRODUCTION } from '@app/env.js';
import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';
import { logger } from '@lib/logger/index.js';

import { EMAIL_KINDS, EmailLogModel, type EmailKind } from './email-log.model.js';
import { EmailSettingModel } from './email-settings.model.js';
import type { MailProvider } from './mail-provider.model.js';
import { mailer } from './mailer.js';
import type { EmailContent } from './templates.js';

/**
 * Kinds that are a direct reply to something a person just did.
 *
 * Two consequences, both of them deliberate:
 *   - no unsubscribe header (there is nothing to unsubscribe from)
 *   - exempt from the per-kind operator kill switch, so switching off
 *     marketing cannot silently strand somebody mid-flow
 */
const TRANSACTIONAL_KINDS = new Set<string>([
  EMAIL_KINDS.PASSWORD_RESET,
  EMAIL_KINDS.PASSWORD_CHANGED,
  EMAIL_KINDS.STAFF_INVITE,
]);

export interface SendInput {
  readonly kind: EmailKind;
  readonly to: string;
  readonly ownerId: string | null;
  readonly content: EmailContent;
  /** Set when an operator triggered it by hand. */
  readonly sentBy?: string;
  /** Set when this is a repeat of a previous send. */
  readonly resendOf?: string;
  /**
   * Force a provider, ignoring the operator's selection.
   *
   * For the console's "try it" button only, so a provider can be proven before
   * live traffic is switched onto it.
   */
  readonly provider?: MailProvider;
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

  async send(
    input: SendInput,
  ): Promise<{ id: string; delivered: boolean; provider: MailProvider | null; error: string | null }> {
    // The kill switch, checked HERE rather than at each callsite — this is the
    // only way an email leaves, so this is the only place it can be stopped.
    // The attempt is still recorded, because "why did nobody get that?" is
    // exactly the question a blocked send has to be able to answer.
    /**
     * Transactional mail is exempt from the operator kill switch.
     *
     * The per-kind switch exists so somebody can stop a marketing sweep. A
     * password reset or a console invite is a reply to something a person just
     * did, and switching those off silently strands them — an invite would be
     * recorded `blocked` and nobody would know why the link never arrived.
     */
    if (!TRANSACTIONAL_KINDS.has(input.kind) && !(await this.isKindEnabled(input.kind))) {
      const blocked = await EmailLogModel.create({
        kind: input.kind,
        to: input.to,
        ownerId: input.ownerId,
        subject: input.content.subject,
        html: input.content.html,
        text: input.content.text,
        status: 'blocked',
        provider: null,
        providerId: null,
        error: 'This kind of email is switched off in the console.',
        sentBy: input.sentBy ?? null,
        resendOf: input.resendOf ?? null,
      });

      logger.info('email blocked by an operator switch', { kind: input.kind, to: input.to });
      // Not a failure: an operator switched this kind off and it worked.
      analytics.track(SERVER_EVENTS.NOTIFICATION_SUPPRESSED, input.ownerId ?? 'system', {
        kind: input.kind,
        reason: 'kind_switched_off',
      });
      return {
        id: blocked._id,
        delivered: false,
        provider: null,
        error: 'This kind of email is switched off in the console.',
      };
    }

    const result = await mailer.send({
      to: input.to,
      content: input.content,
      ...(input.provider !== undefined && { provider: input.provider }),
      // Everything except a password reset gets the header. A reset is a
      // response to a request somebody just made, and offering to unsubscribe
      // from it makes no sense.
      // Transactional mail carries no unsubscribe link: there is nothing to
      // unsubscribe FROM, and for an invite the /settings page it points at is
      // one the recipient cannot even reach yet, having no account.
      ...(!TRANSACTIONAL_KINDS.has(input.kind) && {
        unsubscribeUrl: `${env.APP_URL.replace(/\/+$/, '')}/settings`,
      }),
    });

    // `suppressed` is its own status, not a failure: no key configured is a
    // development state, and calling it "failed" would make a dev log look
    // like an outage. In production the same state IS a failure — an operator
    // selected a provider that cannot send, and that has to be visible in the
    // console rather than filed under "nothing to see here".
    const status = result.delivered
      ? 'sent'
      : !result.configured && !IS_PRODUCTION
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
      provider: result.provider,
      providerId: result.delivered ? result.id : null,
      error: result.delivered ? null : result.reason,
      sentBy: input.sentBy ?? null,
      resendOf: input.resendOf ?? null,
    });

    /**
     * Rates only — the per-send record is `email_logs`, which already holds the
     * subject, the body and the provider id. The reason to have this in
     * analytics at all is to sit sends beside the behaviour they were meant to
     * cause: did `have_you_eaten` actually bring anybody back?
     */
    if (status === 'failed') {
      analytics.track(SERVER_EVENTS.EMAIL_FAILED, input.ownerId ?? 'system', {
        kind: input.kind,
        // `configured` lives only on the failure variant of the union, so the
        // narrowing has to come from `delivered` being false.
        error_class: !result.delivered && result.configured ? 'provider_rejected' : 'not_configured',
      });
    } else if (status === 'suppressed') {
      analytics.track(SERVER_EVENTS.NOTIFICATION_SUPPRESSED, input.ownerId ?? 'system', {
        kind: input.kind,
        reason: 'provider_not_configured',
      });
    } else {
      analytics.track(SERVER_EVENTS.EMAIL_SENT, input.ownerId ?? 'system', {
        kind: input.kind,
        status,
        is_broadcast: input.kind === 'admin_broadcast',
        is_resend: input.resendOf !== undefined && input.resendOf !== null,
      });
    }

    return {
      id: row._id,
      delivered: result.delivered,
      provider: result.provider,
      error: result.delivered ? null : result.reason,
    };
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
