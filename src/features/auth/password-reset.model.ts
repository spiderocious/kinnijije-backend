import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

export interface PasswordResetAttributes {
  _id: string;
  userId: string;
  /**
   * The SHA-256 of the token, never the token.
   *
   * Same reasoning as refresh tokens: a 48-byte random string has no entropy
   * to guess, so a fast hash is enough — and it means a stolen database yields
   * nothing usable.
   */
  tokenHash: string;
  expiresAt: Date;
  /** Set the moment it is spent. A reset link works exactly once. */
  usedAt: Date | null;
  requestedIp: string | null;
  createdAt: Date;
}

const passwordResetSchema = new Schema<PasswordResetAttributes>(
  {
    _id: { type: String, default: () => newId('reset') },
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    requestedIp: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'password_resets',
  },
);

// Mongo removes expired rows on its own, so nothing accumulates and no spent
// token lingers where it could be looked up.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type PasswordResetDocument = HydratedDocument<PasswordResetAttributes>;
export const PasswordResetModel = model<PasswordResetAttributes>(
  'PasswordReset',
  passwordResetSchema,
);
