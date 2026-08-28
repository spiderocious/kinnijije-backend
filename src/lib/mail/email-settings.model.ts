import { model, Schema, type HydratedDocument } from 'mongoose';

import { EMAIL_KINDS, type EmailKind } from './email-log.model.js';

/**
 * The operator's switch for one kind of email.
 *
 * A row exists only once somebody has TOUCHED that kind — absence means
 * enabled. That way a new template ships on by default without a migration,
 * and turning something off is an explicit, recorded act.
 */
export interface EmailSettingAttributes {
  /** The kind is the id. One row per kind, at most. */
  _id: EmailKind;
  enabled: boolean;
  /** Who turned it off, and why, so nobody has to guess later. */
  updatedBy: string | null;
  reason: string | null;
  updatedAt: Date;
}

const emailSettingSchema = new Schema<EmailSettingAttributes>(
  {
    _id: { type: String, required: true, enum: Object.values(EMAIL_KINDS) },
    enabled: { type: Boolean, required: true, default: true },
    updatedBy: { type: String, default: null },
    reason: { type: String, default: null },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
    collection: 'email_settings',
  },
);

export type EmailSettingDocument = HydratedDocument<EmailSettingAttributes>;
export const EmailSettingModel = model<EmailSettingAttributes>(
  'EmailSetting',
  emailSettingSchema,
);
