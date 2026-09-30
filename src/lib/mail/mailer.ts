import { Resend } from 'resend';

import { env, IS_PRODUCTION } from '@app/env.js';
import { logger } from '@lib/logger/index.js';

import {
  MAIL_PROVIDERS,
  MAIL_PROVIDER_SETTING_ID,
  MailProviderSettingModel,
  type MailProvider,
} from './mail-provider.model.js';
import type { EmailContent } from './templates.js';

export interface SendEmailInput {
  to: string;
  content: EmailContent;
  /**
   * Where "unsubscribe" points for THIS message.
   *
   * Set for anything a person opted into. Filters look for the header, not
   * just a link in the body, and its absence is one of the strongest bulk-mail
   * signals there is.
   */
  unsubscribeUrl?: string;
  /**
   * Send through this provider instead of the one the operator selected.
   *
   * For the console's "try it" button only: it proves a provider works before
   * anybody switches live traffic onto it.
   */
  provider?: MailProvider;
}

export type SendEmailResult =
  | { delivered: true; id: string | null; provider: MailProvider }
  | { delivered: false; reason: string; provider: MailProvider; configured: boolean };

/**
 * One way to talk to one email provider.
 *
 * `isConfigured` is separate from sending because the console shows it: an
 * operator picking a provider needs to see, up front, whether it has
 * credentials at all.
 */
interface EmailProvider {
  readonly name: MailProvider;
  readonly isConfigured: boolean;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

/** Headers shared by both providers. Deliverability does not vary by vendor. */
const unsubscribeHeaders = (unsubscribeUrl: string | undefined): Record<string, string> =>
  unsubscribeUrl === undefined
    ? {}
    : {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        // Says the link is safe to fetch, so a client can offer one-click.
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };

class ResendProvider implements EmailProvider {
  readonly name = MAIL_PROVIDERS.RESEND;

  private readonly client: Resend | null;

  constructor(apiKey: string) {
    this.client = apiKey.length > 0 ? new Resend(apiKey) : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async send({ to, content, unsubscribeUrl }: SendEmailInput): Promise<SendEmailResult> {
    if (this.client === null) {
      return {
        delivered: false,
        reason: 'RESEND_API_KEY is not configured.',
        provider: this.name,
        configured: false,
      };
    }

    const { data, error } = await this.client.emails.send({
      from: env.MAIL_FROM,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      // A real address a person can write to. Mail from an unattended box
      // that cannot be replied to reads as bulk, to filters and to people.
      replyTo: env.MAIL_REPLY_TO,
      headers: unsubscribeHeaders(unsubscribeUrl),
    });

    if (error !== null) {
      logger.error('resend rejected email', { to, subject: content.subject, error });
      return { delivered: false, reason: error.message, provider: this.name, configured: true };
    }

    return { delivered: true, id: data?.id ?? null, provider: this.name };
  }
}

/**
 * Cloudflare Email Sending, over its REST API.
 *
 * A plain `fetch` rather than an SDK: it is one POST, and a dependency for one
 * POST is a dependency to keep updated for no reason.
 */
class CloudflareProvider implements EmailProvider {
  readonly name = MAIL_PROVIDERS.CLOUDFLARE;

  constructor(
    private readonly token: string,
    private readonly accountId: string,
    private readonly from: string,
  ) {}

  get isConfigured(): boolean {
    return this.token.length > 0 && this.accountId.length > 0 && this.from.length > 0;
  }

  async send({ to, content, unsubscribeUrl }: SendEmailInput): Promise<SendEmailResult> {
    if (!this.isConfigured) {
      return {
        delivered: false,
        reason:
          'Cloudflare is selected but CLOUDFLARE_EMAIL_SENDING_TOKEN, CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_MAIL_FROM is missing.',
        provider: this.name,
        configured: false,
      };
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/email/sending/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to,
          from: this.from,
          subject: content.subject,
          html: content.html,
          text: content.text,
          ...(unsubscribeUrl !== undefined && { headers: unsubscribeHeaders(unsubscribeUrl) }),
        }),
      },
    );

    const body = (await response.json().catch(() => null)) as CloudflareSendResponse | null;

    if (!response.ok || body === null || body.success !== true) {
      const reason =
        body?.errors?.map((error) => error.message).join('; ') ??
        `Cloudflare returned HTTP ${String(response.status)}.`;
      logger.error('cloudflare rejected email', {
        to,
        subject: content.subject,
        status: response.status,
        errors: body?.errors,
      });
      return { delivered: false, reason, provider: this.name, configured: true };
    }

    // An accepted message lands in `queued`, not `delivered` — an empty
    // `delivered` list is the normal case, not a failure. What does matter is
    // the recipient turning up as a hard bounce or on the suppression list:
    // Cloudflare still answers `success: true`, and recording that as sent
    // would hide mail that never had a chance of arriving.
    const rejected = [
      ...(body.result?.permanent_bounces ?? []),
      ...(body.result?.suppressed_recipients ?? []),
    ];

    if (rejected.includes(to)) {
      logger.warn('cloudflare accepted the request but rejected the recipient', { to });
      return {
        delivered: false,
        reason: 'Cloudflare rejected this recipient (hard bounce or suppressed).',
        provider: this.name,
        configured: true,
      };
    }

    return { delivered: true, id: body.result?.message_id ?? null, provider: this.name };
  }
}

/** Only the fields we rely on; Cloudflare may send more. */
interface CloudflareSendResponse {
  success: boolean;
  errors?: { code: number; message: string }[];
  result?: {
    message_id?: string;
    delivered?: string[];
    queued?: string[];
    permanent_bounces?: string[];
    suppressed_recipients?: string[];
  } | null;
}

/**
 * How long a provider choice is trusted without re-reading it.
 *
 * Every send already reads the per-kind switch, and a second round-trip per
 * email to answer a question whose answer changes a few times a year is not
 * worth it. The cost of the cache is that a switch takes up to this long to
 * take effect everywhere — which is why the console's own write clears it.
 */
const PROVIDER_CACHE_MS = 30_000;

/**
 * The facade over every email provider. Nothing else in the codebase imports
 * `resend` or calls Cloudflare, so adding or swapping a provider touches this
 * file alone.
 *
 * Failure to send is returned, never thrown. Email is a side effect of an
 * action, not the action: a welcome email that bounces must not fail the
 * registration that triggered it.
 */
export class Mailer {
  private readonly providers: Record<MailProvider, EmailProvider>;

  private cached: { provider: MailProvider; readAt: number } | null = null;

  private constructor() {
    this.providers = {
      [MAIL_PROVIDERS.RESEND]: new ResendProvider(env.RESEND_API_KEY),
      [MAIL_PROVIDERS.CLOUDFLARE]: new CloudflareProvider(
        env.CLOUDFLARE_EMAIL_SENDING_TOKEN,
        env.CLOUDFLARE_ACCOUNT_ID,
        env.CLOUDFLARE_MAIL_FROM,
      ),
    };
  }

  private static instance: Mailer | undefined;

  static getInstance(): Mailer {
    Mailer.instance ??= new Mailer();
    return Mailer.instance;
  }

  /**
   * The provider an operator selected, or the environment's seed if nobody has.
   *
   * A database that cannot be read must not stop mail going out, so a failed
   * read falls back to the seed rather than throwing.
   */
  async activeProvider(): Promise<MailProvider> {
    const now = Date.now();
    if (this.cached !== null && now - this.cached.readAt < PROVIDER_CACHE_MS) {
      return this.cached.provider;
    }

    try {
      const row = await MailProviderSettingModel.findById(MAIL_PROVIDER_SETTING_ID).exec();
      const provider = row?.provider ?? env.MAIL_PROVIDER;
      this.cached = { provider, readAt: now };
      return provider;
    } catch (error) {
      logger.error('could not read the mail provider setting, using the configured default', {
        fallback: env.MAIL_PROVIDER,
        error: error instanceof Error ? error : String(error),
      });
      return env.MAIL_PROVIDER;
    }
  }

  /** Called by the console the moment it writes a new choice. */
  forgetCachedProvider(): void {
    this.cached = null;
  }

  /** Which providers could send right now. Drives the console's warnings. */
  configuredProviders(): Record<MailProvider, boolean> {
    return {
      [MAIL_PROVIDERS.RESEND]: this.providers[MAIL_PROVIDERS.RESEND].isConfigured,
      [MAIL_PROVIDERS.CLOUDFLARE]: this.providers[MAIL_PROVIDERS.CLOUDFLARE].isConfigured,
    };
  }

  isProviderConfigured(provider: MailProvider): boolean {
    return this.providers[provider].isConfigured;
  }

  /**
   * True when mail can actually go out on the selected provider.
   *
   * Deliberately NOT "any provider works": if an operator selected Cloudflare,
   * Resend having a key is no consolation.
   */
  async isLive(): Promise<boolean> {
    return this.isProviderConfigured(await this.activeProvider());
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const name = input.provider ?? (await this.activeProvider());
    const provider = this.providers[name];

    // A provider selected without credentials fails the send, and says so.
    // It does NOT quietly fall back to the other one: sending from an address
    // the operator did not choose is worse than not sending, and a silent
    // fallback would hide the misconfiguration for as long as it lasted.
    if (!provider.isConfigured) {
      const reason =
        name === MAIL_PROVIDERS.RESEND
          ? 'RESEND_API_KEY is not configured.'
          : 'Cloudflare is selected but its credentials are missing.';

      // Outside production this is the ordinary "no key locally" state, and
      // logging it as an error would make every dev run look broken.
      const note = 'email not sent: the selected provider is not configured';
      if (IS_PRODUCTION) {
        logger.error(note, { provider: name, to: input.to, subject: input.content.subject });
      } else {
        logger.info(note, {
          provider: name,
          to: input.to,
          subject: input.content.subject,
          preview: input.content.text.slice(0, 160),
        });
      }

      return { delivered: false, reason, provider: name, configured: false };
    }

    try {
      const result = await provider.send(input);

      if (result.delivered) {
        logger.info('email sent', {
          provider: name,
          to: input.to,
          subject: input.content.subject,
          id: result.id,
        });
      }

      return result;
    } catch (error) {
      // An upstream outage must not take a request down with it.
      logger.error('email send threw', {
        provider: name,
        to: input.to,
        subject: input.content.subject,
        error: error instanceof Error ? error : String(error),
      });
      return {
        delivered: false,
        reason: error instanceof Error ? error.message : 'unknown',
        provider: name,
        configured: true,
      };
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

/**
 * Boot check: in production, the provider that will actually be used must have
 * credentials.
 *
 * This reads the database, so it runs after the connection is open. It warns
 * rather than throws when the SELECTED provider is missing credentials —
 * refusing to boot would turn a bad email setting into a total outage, and the
 * failure is already loud in the console and in every email log row.
 */
export const assertMailerConfigured = async (): Promise<void> => {
  if (!IS_PRODUCTION) return;

  const provider = await mailer.activeProvider();

  if (!mailer.isProviderConfigured(provider)) {
    logger.error(
      'the selected email provider has no credentials — every send will fail until this is fixed',
      { provider, configured: mailer.configuredProviders() },
    );
    return;
  }

  logger.info('email provider ready', { provider });
};
