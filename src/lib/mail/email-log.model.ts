import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

import { MAIL_PROVIDERS, type MailProvider } from './mail-provider.model.js';

/** What kind of email it was. Drives filtering and the resend path. */
export const EMAIL_KINDS = {
  WELCOME: 'welcome',
  PASSWORD_RESET: 'password_reset',
  PASSWORD_CHANGED: 'password_changed',
  STATUS_CHANGED: 'status_changed',
  LOW_STOCK: 'low_stock',
  USE_IT_UP: 'use_it_up',
  DAILY_DIGEST: 'daily_digest',
  WEEKLY_SUMMARY: 'weekly_summary',
  HAVE_YOU_EATEN: 'have_you_eaten',
  ADMIN_BROADCAST: 'admin_broadcast',
  /**
   * An invitation to join the console.
   *
   * Added to this enum FIRST, deliberately: `kind` is enum-validated by the
   * schema and the log row is written AFTER the mail is handed to the
   * provider, so sending an unregistered kind would deliver the email and then
   * throw on the log write.
   */
  STAFF_INVITE: 'staff_invite',
} as const;

export type EmailKind = (typeof EMAIL_KINDS)[keyof typeof EMAIL_KINDS];

export interface EmailLogAttributes {
  _id: string;
  kind: EmailKind;
  to: string;
  /** Null for an email to somebody who is not a user (there are none yet). */
  ownerId: string | null;
  subject: string;
  /** Stored so the console can show exactly what was sent, not a guess. */
  html: string;
  text: string;
  /**
   * `suppressed` — no mail key configured, a development state.
   * `blocked`    — an operator switched this kind off.
   * Neither is a failure, and calling them one would hide a real outage.
   */
  status: 'sent' | 'failed' | 'suppressed' | 'blocked';
  /**
   * Which provider handled it.
   *
   * Null on rows written before there was more than one, and on a `blocked`
   * send, which never reached a provider at all. Without this, one switch makes
   * every past failure unattributable — which is the whole point of being able
   * to switch.
   */
  provider: MailProvider | null;
  /** The provider's id for the message, when it accepted it. */
  providerId: string | null;
  error: string | null;
  /** Set when an operator sent it by hand. */
  sentBy: string | null;
  /** Points at the original when this send is a repeat of one. */
  resendOf: string | null;
  createdAt: Date;
}

const emailLogSchema = new Schema<EmailLogAttributes>(
  {
    _id: { type: String, default: () => newId('email') },
    kind: { type: String, required: true, enum: Object.values(EMAIL_KINDS), index: true },
    to: { type: String, required: true, index: true },
    ownerId: { type: String, default: null, index: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['sent', 'failed', 'suppressed', 'blocked'],
      index: true,
    },
    provider: { type: String, enum: Object.values(MAIL_PROVIDERS), default: null, index: true },
    providerId: { type: String, default: null },
    error: { type: String, default: null },
    sentBy: { type: String, default: null },
    resendOf: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'email_logs',
  },
);

emailLogSchema.index({ createdAt: -1 });
// "Have we already sent this person this kind of email recently?" — the query
// behind every frequency cap, so it gets its own index.
emailLogSchema.index({ ownerId: 1, kind: 1, createdAt: -1 });

export type EmailLogDocument = HydratedDocument<EmailLogAttributes>;
export const EmailLogModel = model<EmailLogAttributes>('EmailLog', emailLogSchema);
