import { model, Schema, type HydratedDocument } from 'mongoose';

/** The providers the mailer knows how to talk to. */
export const MAIL_PROVIDERS = {
  RESEND: 'resend',
  CLOUDFLARE: 'cloudflare',
} as const;

export type MailProvider = (typeof MAIL_PROVIDERS)[keyof typeof MAIL_PROVIDERS];

/**
 * Which provider is sending mail right now.
 *
 * One row, ever — `_id` is a constant. It lives in the database rather than in
 * the environment because switching provider is an operational decision, taken
 * mid-incident and without a redeploy. Absence means "nobody has chosen yet",
 * and the mailer falls back to env.MAIL_PROVIDER, so a fresh install needs no
 * migration and no seeding.
 */
export const MAIL_PROVIDER_SETTING_ID = 'active';

export interface MailProviderSettingAttributes {
  _id: typeof MAIL_PROVIDER_SETTING_ID;
  provider: MailProvider;
  /** Who switched it, so nobody has to guess later. */
  updatedBy: string | null;
  reason: string | null;
  updatedAt: Date;
}

const mailProviderSettingSchema = new Schema<MailProviderSettingAttributes>(
  {
    _id: { type: String, required: true, enum: [MAIL_PROVIDER_SETTING_ID] },
    provider: { type: String, required: true, enum: Object.values(MAIL_PROVIDERS) },
    updatedBy: { type: String, default: null },
    reason: { type: String, default: null },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
    collection: 'mail_provider_settings',
  },
);

export type MailProviderSettingDocument = HydratedDocument<MailProviderSettingAttributes>;
export const MailProviderSettingModel = model<MailProviderSettingAttributes>(
  'MailProviderSetting',
  mailProviderSettingSchema,
);
