import { Resend } from 'resend';

import { env, IS_PRODUCTION } from '@app/env.js';
import { logger } from '@lib/logger/index.js';

import type { EmailContent } from './templates.js';

export interface SendEmailInput {
  to: string;
  content: EmailContent;
}

export type SendEmailResult =
  | { delivered: true; id: string | null }
  | { delivered: false; reason: string };

/**
 * The facade over Resend. Nothing else in the codebase imports `resend`, so
 * swapping providers touches this file alone.
 *
 * Failure to send is returned, never thrown. Email is a side effect of an
 * action, not the action: a welcome email that bounces must not fail the
 * registration that triggered it.
 */
export class Mailer {
  private readonly client: Resend | null;

  private constructor(apiKey: string) {
    // With no key configured the mailer logs instead of sending, so a
    // developer can run the whole auth flow locally without a Resend account
    // and without a stray real email. Production demands a real key — asserted
    // at boot in server.ts, not silently degraded here.
    this.client = apiKey.length > 0 ? new Resend(apiKey) : null;
  }

  private static instance: Mailer | undefined;

  static getInstance(): Mailer {
    Mailer.instance ??= new Mailer(env.RESEND_API_KEY);
    return Mailer.instance;
  }

  get isLive(): boolean {
    return this.client !== null;
  }

  async send({ to, content }: SendEmailInput): Promise<SendEmailResult> {
    if (this.client === null) {
      logger.info('email suppressed (no RESEND_API_KEY configured)', {
        to,
        subject: content.subject,
        preview: content.text.slice(0, 160),
      });
      return { delivered: false, reason: 'mailer_not_configured' };
    }

    try {
      const { data, error } = await this.client.emails.send({
        from: env.MAIL_FROM,
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });

      if (error !== null) {
        logger.error('resend rejected email', { to, subject: content.subject, error });
        return { delivered: false, reason: error.message };
      }

      logger.info('email sent', { to, subject: content.subject, id: data?.id });
      return { delivered: true, id: data?.id ?? null };
    } catch (error) {
      // An upstream outage must not take a request down with it.
      logger.error('email send threw', {
        to,
        subject: content.subject,
        error: error instanceof Error ? error : String(error),
      });
      return { delivered: false, reason: error instanceof Error ? error.message : 'unknown' };
    }
  }

  /**
   * Fire-and-forget for side-effect email. The floating promise is handled
   * here rather than at each callsite, so no caller has to remember `.catch`
   * and no request waits on an email round-trip.
   *
   * A genuine outbox — write the intent in the same transaction, let a worker
   * deliver it — is the durable version of this. That is a separate piece of
   * work; this is honest about being best-effort.
   */
  dispatch(input: SendEmailInput): void {
    void this.send(input).catch((error: unknown) => {
      logger.error('email dispatch failed', {
        to: input.to,
        error: error instanceof Error ? error : String(error),
      });
    });
  }
}

export const mailer = Mailer.getInstance();

export const assertMailerConfigured = (): void => {
  if (IS_PRODUCTION && !mailer.isLive) {
    throw new Error('RESEND_API_KEY is required in production');
  }
};
