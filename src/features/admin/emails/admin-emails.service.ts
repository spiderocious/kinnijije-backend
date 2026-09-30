import { UserModel } from '@features/users/users.model.js';
import { isoOrNull } from '@lib/dates.js';
import { logger } from '@lib/logger/index.js';
import {
  adminBroadcastEmail,
  EMAIL_KINDS,
  EmailLogModel,
  emailService,
  EmailSettingModel,
  MAIL_PROVIDER_SETTING_ID,
  mailer,
  MailProviderSettingModel,
  type EmailKind,
  type MailProvider,
} from '@lib/mail/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

export interface ComposeInput {
  /** Explicit recipients. Ignored when `audience` is anything but 'selected'. */
  readonly userIds?: string[];
  readonly audience: 'selected' | 'all' | 'active' | 'pending' | 'onboarded' | 'not_onboarded';
  readonly subject: string;
  readonly body: string;
}

/**
 * Email an operator wrote.
 *
 * Sent one at a time rather than as a single multi-recipient message, so each
 * person gets their own name, their own log row, and no visibility of anybody
 * else's address.
 */
export class AdminEmailsService {
  private static instance: AdminEmailsService | undefined;

  static getInstance(): AdminEmailsService {
    AdminEmailsService.instance ??= new AdminEmailsService();
    return AdminEmailsService.instance;
  }

  /** Who a given audience resolves to, so the console can say "42 people". */
  async resolveAudience(input: Pick<ComposeInput, 'audience' | 'userIds'>) {
    if (input.audience === 'selected') {
      const ids = input.userIds ?? [];
      if (ids.length === 0) return [];
      return UserModel.find({ _id: { $in: ids } }).select('_id email name').exec();
    }

    const filter: Record<string, unknown> = {};
    switch (input.audience) {
      case 'active':
        filter['status'] = USER_STATUSES.ACTIVE;
        break;
      case 'pending':
        filter['status'] = USER_STATUSES.PENDING;
        break;
      case 'onboarded':
        filter['onboardingCompletedAt'] = { $ne: null };
        break;
      case 'not_onboarded':
        filter['onboardingCompletedAt'] = null;
        break;
      default:
        // 'all' still excludes banned and deleted accounts — "everyone" never
        // means people who were removed.
        filter['status'] = {
          $in: [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING, USER_STATUSES.SUSPENDED],
        };
    }

    return UserModel.find(filter).select('_id email name').exec();
  }

  async preview(input: Pick<ComposeInput, 'audience' | 'userIds'>): Promise<ServiceResult<{ count: number; sample: string[] }>> {
    const users = await this.resolveAudience(input);
    return ok({
      count: users.length,
      sample: users.slice(0, 5).map((user) => user.email),
    });
  }

  async send(input: ComposeInput, actorId: string): Promise<ServiceResult<{ sent: number; failed: number }>> {
    const users = await this.resolveAudience(input);

    if (users.length === 0) {
      return fail(
        ERROR_CODES.VALIDATION_ERROR,
        MESSAGE_KEYS.common.VALIDATION_ERROR,
        HTTP_STATUS.BAD_REQUEST,
        { rejectionReason: 'no_recipients' },
      );
    }

    // Blank lines become paragraphs. Operators write in a textarea, not HTML.
    const lines = input.body
      .split(/\n{2,}/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    let sent = 0;
    let failed = 0;

    for (const user of users) {
      try {
        const result = await emailService.send({
          kind: EMAIL_KINDS.ADMIN_BROADCAST,
          to: user.email,
          ownerId: user._id,
          content: adminBroadcastEmail(user.name, input.subject, lines),
          sentBy: actorId,
        });
        if (result.delivered) sent += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        logger.error('admin email failed for one recipient', {
          user_id: user._id,
          error: error instanceof Error ? error : String(error),
        });
      }
    }

    logger.info('admin email sent', { by: actorId, audience: input.audience, sent, failed });
    return ok({ sent, failed });
  }

  async list(query: {
    kind?: string;
    status?: string;
    provider?: string;
    to?: string;
    limit?: number;
    skip?: number;
  }): Promise<ServiceResult<{ items: unknown[]; total: number }>> {
    const filter: Record<string, unknown> = {};
    if (query.kind !== undefined) filter['kind'] = query.kind;
    if (query.status !== undefined) filter['status'] = query.status;
    if (query.provider !== undefined) filter['provider'] = query.provider;
    if (query.to !== undefined && query.to.length > 0) {
      filter['to'] = { $regex: query.to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    const limit = Math.min(query.limit ?? 50, 200);
    const [rows, total] = await Promise.all([
      // The bodies are kilobytes each; the list does not need them.
      EmailLogModel.find(filter)
        .select('-html -text')
        .sort({ createdAt: -1 })
        .skip(query.skip ?? 0)
        .limit(limit)
        .exec(),
      EmailLogModel.countDocuments(filter).exec(),
    ]);

    return ok({
      items: rows.map((row) => ({
        id: row._id,
        kind: row.kind,
        to: row.to,
        owner_id: row.ownerId,
        subject: row.subject,
        status: row.status,
        provider: row.provider,
        provider_id: row.providerId,
        error: row.error,
        sent_by: row.sentBy,
        resend_of: row.resendOf,
        created_at: isoOrNull(row.createdAt),
      })),
      total,
    });
  }

  /** One email, including exactly what was sent. */
  async detail(emailId: string): Promise<ServiceResult<unknown>> {
    const row = await EmailLogModel.findById(emailId).exec();
    if (row === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    return ok({
      id: row._id,
      kind: row.kind,
      to: row.to,
      owner_id: row.ownerId,
      subject: row.subject,
      html: row.html,
      text: row.text,
      status: row.status,
      provider: row.provider,
      provider_id: row.providerId,
      error: row.error,
      sent_by: row.sentBy,
      resend_of: row.resendOf,
      created_at: isoOrNull(row.createdAt),
    });
  }

  /**
   * Send the same email again.
   *
   * The STORED html and text are reused rather than re-rendered — a template
   * rebuilt today would produce something different from what was sent, and the
   * point of a resend is that somebody did not receive what we already sent.
   */
  async resend(emailId: string, actorId: string): Promise<ServiceResult<{ id: string; delivered: boolean }>> {
    const original = await EmailLogModel.findById(emailId).exec();
    if (original === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const result = await emailService.send({
      kind: original.kind,
      to: original.to,
      ownerId: original.ownerId,
      content: { subject: original.subject, html: original.html, text: original.text },
      sentBy: actorId,
      resendOf: original._id,
    });

    logger.info('email resent', { original: emailId, by: actorId, delivered: result.delivered });
    return ok(result);
  }

  /**
   * Every kind, whether it is on, and who last touched it.
   *
   * Built from the FULL list of kinds rather than from the rows, because a kind
   * nobody has ever switched has no row — and it still has to appear, switched
   * on, or the console would only list the ones somebody had disabled.
   */
  async settings(): Promise<ServiceResult<unknown[]>> {
    const rows = await EmailSettingModel.find().exec();
    const byKind = new Map(rows.map((row) => [row._id, row]));

    return ok(
      Object.values(EMAIL_KINDS).map((kind) => {
        const row = byKind.get(kind);
        return {
          kind,
          enabled: row?.enabled !== false,
          updated_by: row?.updatedBy ?? null,
          reason: row?.reason ?? null,
          updated_at: isoOrNull(row?.updatedAt),
        };
      }),
    );
  }

  /**
   * Turn one kind on or off, for everybody.
   *
   * The app keeps triggering as it always did — the switch is enforced at the
   * one place email leaves, so a blocked send is still recorded and still
   * visible. Nothing upstream has to know.
   */
  async setKindEnabled(
    kind: EmailKind,
    enabled: boolean,
    actorId: string,
    reason?: string,
  ): Promise<ServiceResult<null>> {
    await EmailSettingModel.findByIdAndUpdate(
      kind,
      {
        $set: {
          enabled,
          updatedBy: actorId,
          reason: reason ?? null,
        },
      },
      { upsert: true },
    ).exec();

    logger.info('email kind switched', { kind, enabled, by: actorId, reason });
    return ok(null);
  }

  /**
   * Which provider is live, and which ones could be.
   *
   * `configured` is the important half: an operator about to switch needs to
   * see that the target has credentials BEFORE they switch, not afterwards in a
   * column of failures.
   */
  async provider(): Promise<
    ServiceResult<{
      provider: MailProvider;
      /** False when nothing has been chosen and this is the env default. */
      chosen: boolean;
      configured: Record<MailProvider, boolean>;
      live: boolean;
      updated_by: string | null;
      reason: string | null;
      updated_at: string | null;
    }>
  > {
    const row = await MailProviderSettingModel.findById(MAIL_PROVIDER_SETTING_ID).exec();
    const active = await mailer.activeProvider();

    return ok({
      provider: active,
      chosen: row !== null,
      configured: mailer.configuredProviders(),
      live: mailer.isProviderConfigured(active),
      updated_by: row?.updatedBy ?? null,
      reason: row?.reason ?? null,
      updated_at: isoOrNull(row?.updatedAt),
    });
  }

  /**
   * Point every outgoing email at a different provider, from now on.
   *
   * Switching to a provider with no credentials is ALLOWED and only warned
   * about. Refusing would be the wrong call: the console is also where somebody
   * recovers from a broken setting, and the failure is loud anyway — every send
   * is logged `failed` with the reason, and this response says `live: false`.
   */
  async setProvider(
    provider: MailProvider,
    actorId: string,
    reason?: string,
  ): Promise<ServiceResult<{ provider: MailProvider; live: boolean }>> {
    await MailProviderSettingModel.findByIdAndUpdate(
      MAIL_PROVIDER_SETTING_ID,
      { $set: { provider, updatedBy: actorId, reason: reason ?? null } },
      { upsert: true },
    ).exec();

    // The mailer caches the choice for a few seconds; clearing it here is what
    // makes the switch take effect immediately rather than eventually.
    mailer.forgetCachedProvider();

    const live = mailer.isProviderConfigured(provider);
    if (!live) {
      logger.error('an email provider with no credentials was selected', {
        provider,
        by: actorId,
      });
    } else {
      logger.info('email provider switched', { provider, by: actorId, reason });
    }

    return ok({ provider, live });
  }

  /**
   * Send one real email through a named provider, without switching anything.
   *
   * The point is to prove a provider works before live traffic depends on it.
   * It goes through `emailService`, so the attempt is logged like any other and
   * shows up in the console with its provider and its error.
   */
  async testProvider(
    provider: MailProvider,
    to: string,
    actorId: string,
  ): Promise<ServiceResult<{ id: string; delivered: boolean; error: string | null }>> {
    const content = adminBroadcastEmail(null, `Test send via ${provider}`, [
      `This is a test of the ${provider} email provider.`,
      'If you are reading this, that provider can send mail. Nothing has been switched — this was a one-off.',
    ]);

    const result = await emailService.send({
      kind: EMAIL_KINDS.ADMIN_BROADCAST,
      to,
      ownerId: null,
      content,
      sentBy: actorId,
      provider,
    });

    logger.info('email provider tested', {
      provider,
      to,
      by: actorId,
      delivered: result.delivered,
    });

    return ok({ id: result.id, delivered: result.delivered, error: result.error });
  }

  /** The kinds that have actually been sent, for the filter rail. */
  async kinds(): Promise<ServiceResult<string[]>> {
    const kinds = await EmailLogModel.distinct('kind').exec();
    return ok(kinds.map(String).sort());
  }
}

export const adminEmailsService = AdminEmailsService.getInstance();
