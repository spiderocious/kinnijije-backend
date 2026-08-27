import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

export type RevokedReason =
  | 'logout'
  | 'rotated'
  | 'reuse_detected'
  | 'password_change'
  | 'status_change'
  | 'role_change';

/**
 * One row per issued refresh token.
 *
 * The token itself is never stored — only a SHA-256 hash of it. A database
 * dump therefore does not hand out live sessions. Lookup is by hash, which is
 * why the index is on that column.
 */
const sessionSchema = new Schema(
  {
    _id: { type: String, default: () => newId('session') },

    userId: { type: String, required: true, index: true },

    refreshTokenHash: { type: String, required: true, unique: true, index: true },

    expiresAt: { type: Date, required: true },

    /**
     * Set when the token is rotated away or the user logs out. A *presented*
     * token that is already revoked means the token was replayed — probable
     * theft — and triggers revoking every session for that user.
     */
    revokedAt: { type: Date, default: null },

    /** Which session replaced this one. Makes a rotation chain auditable. */
    replacedBySessionId: { type: String, default: null },

    /**
     * Why the session ended. A deliberate logout and a rotated-away token look
     * identical without this — and they must not be treated the same, because
     * only one of them is evidence of theft.
     */
    revokedReason: {
      type: String,
      enum: ['logout', 'rotated', 'reuse_detected', 'password_change', 'status_change', 'role_change'],
      default: null,
    },

    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'auth_sessions',
  },
);

/**
 * Mongo drops expired documents automatically, so dead sessions do not
 * accumulate forever. It runs about once a minute, so it is housekeeping —
 * expiry is still enforced in the query, never left to the TTL alone.
 */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Declared explicitly for the same reason as UserAttributes — see users.model.ts. */
export interface SessionAttributes {
  _id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  revokedReason: RevokedReason | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionDocument = HydratedDocument<SessionAttributes>;

export const SessionModel = model<SessionAttributes>('AuthSession', sessionSchema);
