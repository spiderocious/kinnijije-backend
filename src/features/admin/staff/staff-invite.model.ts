import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * An outstanding invitation to join the console.
 *
 * Modelled on `password_resets` — hashed token, TTL index, single-use — with
 * three fields it does not need: who invited, what was offered, and whether it
 * has been withdrawn.
 */
export interface StaffInviteAttributes {
  _id: string;
  /** The `invited` staff row this will activate. Never a `users` id. */
  staffId: string;
  email: string;
  /**
   * SHA-256 of the token, never the token.
   *
   * A 48-byte random string has no entropy to guess, so a fast hash is enough
   * — and it means a stolen database yields nothing usable.
   */
  tokenHash: string;
  /**
   * SNAPSHOTTED at the moment of invitation, not resolved on acceptance.
   *
   * If this stored only a group key, editing that group between sending and
   * acceptance would silently change what the new hire ends up with, and the
   * trail would show the invite rather than the change. Freezing it means what
   * was offered is what is granted.
   */
  scopes: string[];
  groupKeys: string[];
  tier: string;
  invitedBy: string;
  expiresAt: Date;
  /** Set the moment it is spent. An invite works exactly once. */
  usedAt: Date | null;
  /** Set when withdrawn, or superseded by a re-invite. */
  revokedAt: Date | null;
  createdAt: Date;
}

const staffInviteSchema = new Schema<StaffInviteAttributes>(
  {
    _id: { type: String, default: () => newId('invite') },
    staffId: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    scopes: { type: [String], default: [] },
    groupKeys: { type: [String], default: [] },
    tier: { type: String, required: true },
    invitedBy: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'staff_invites',
  },
);

/**
 * Mongo removes expired rows on its own, so nothing accumulates and no spent
 * token lingers where it could be looked up.
 *
 * NOTE: the `invited` STAFF row deliberately survives this — the staff list
 * should show "invited, expired" so somebody can chase it, rather than the
 * person silently vanishing.
 */
staffInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type StaffInviteDocument = HydratedDocument<StaffInviteAttributes>;
export const StaffInviteModel = model<StaffInviteAttributes>('StaffInvite', staffInviteSchema);
