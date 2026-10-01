import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * Console sessions, separate from customer sessions.
 *
 * Kept apart for the same reason the accounts are: revoking a staff member's
 * console access must not touch whatever they have open as a customer, and
 * vice versa.
 */
export interface StaffSessionAttributes {
  _id: string;
  staffId: string;
  /** SHA-256 of the refresh token, never the token. */
  refreshTokenHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
}

const staffSessionSchema = new Schema<StaffSessionAttributes>(
  {
    _id: { type: String, default: () => newId('staffSession') },
    staffId: { type: String, required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'staff_sessions' },
);

// Mongo sweeps expired rows itself, so nothing accumulates.
staffSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type StaffSessionDocument = HydratedDocument<StaffSessionAttributes>;
export const StaffSessionModel = model<StaffSessionAttributes>('StaffSession', staffSessionSchema);
