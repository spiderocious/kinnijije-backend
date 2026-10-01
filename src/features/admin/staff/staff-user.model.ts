import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * Console accounts. A SEPARATE identity domain from `users`.
 *
 * Not a role on a customer row, and not a table that decorates one. Staff and
 * customers are two populations that happen to be able to share an email
 * address, and keeping them apart is what removes a whole class of bug:
 *
 *   - Granting somebody console access can no longer touch their customer
 *     account, so it cannot overwrite a password that belongs to them. That
 *     was a genuine account-takeover primitive when admin was a field on the
 *     user row.
 *   - "Is this person staff?" and "which account is this?" stop being the
 *     same question answered by one field.
 *   - There is no precedence puzzle — no suspended-user-with-active-staff-row
 *     to reconcile, because authorisation reads exactly one collection.
 *
 * `email` is unique WITHIN staff only, so one address can legitimately be both
 * a customer and a member of staff.
 */

export const STAFF_TIERS = {
  /** Read-mostly. Reaches the console; holds whatever scopes it is granted. */
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  /** Bypasses scope checks entirely. The owner. */
  SUPER_ADMIN: 'super_admin',
} as const;

export type StaffTier = (typeof STAFF_TIERS)[keyof typeof STAFF_TIERS];
export const ALL_STAFF_TIERS: readonly StaffTier[] = Object.values(STAFF_TIERS);

const TIER_RANK: Record<StaffTier, number> = {
  [STAFF_TIERS.MODERATOR]: 0,
  [STAFF_TIERS.ADMIN]: 1,
  [STAFF_TIERS.SUPER_ADMIN]: 2,
};

/** "This tier or above". Lets a route say `admin+` without listing every tier. */
export const tierAtLeast = (tier: StaffTier, minimum: StaffTier): boolean =>
  TIER_RANK[tier] >= TIER_RANK[minimum];

export const STAFF_STATUSES = {
  /** Invited, no password yet. Cannot hold a session. */
  INVITED: 'invited',
  ACTIVE: 'active',
  /** Reversible. Keeps the row and the permissions; refuses the session. */
  SUSPENDED: 'suspended',
  /** Left. Kept so the audit trail still resolves who they were. */
  REVOKED: 'revoked',
} as const;

export type StaffStatus = (typeof STAFF_STATUSES)[keyof typeof STAFF_STATUSES];
export const ALL_STAFF_STATUSES: readonly StaffStatus[] = Object.values(STAFF_STATUSES);

/** The only status that may hold a console session. */
export const STAFF_SESSION_ALLOWED: readonly StaffStatus[] = [STAFF_STATUSES.ACTIVE];

export interface StaffUserAttributes {
  _id: string;
  email: string;
  /**
   * Null until an invitation is accepted — that is what `invited` means.
   * `select: false` keeps it out of every query that did not ask for it.
   */
  passwordHash: string | null;
  name: string;
  tier: StaffTier;
  status: StaffStatus;
  /** Flattened scopes. The authority on what this account may do. */
  permissions: string[];
  /** Groups applied, for display. Never consulted when authorising. */
  permissionGroupKeys: string[];
  /**
   * The customer account belonging to the same person, when there is one.
   *
   * DISPLAY ONLY — never read when authorising, and deliberately not a
   * reference that grants anything. It exists so the console can say "this
   * person is also a customer", which is useful context and nothing more.
   */
  linkedUserId: string | null;
  invitedBy: string | null;
  lastConsoleLoginAt: Date | null;
  /** Why access was removed. Shown in the staff list. */
  statusReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const staffUserSchema = new Schema<StaffUserAttributes>(
  {
    _id: { type: String, default: () => newId('staff') },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    passwordHash: { type: String, default: null, select: false },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    tier: { type: String, required: true, enum: ALL_STAFF_TIERS, default: STAFF_TIERS.MODERATOR, index: true },
    status: { type: String, required: true, enum: ALL_STAFF_STATUSES, default: STAFF_STATUSES.INVITED, index: true },
    permissions: { type: [String], default: [] },
    permissionGroupKeys: { type: [String], default: [] },
    linkedUserId: { type: String, default: null },
    invitedBy: { type: String, default: null },
    lastConsoleLoginAt: { type: Date, default: null },
    statusReason: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'staff_users' },
);

// The staff list: everybody, newest first. Small collection, but it is read on
// every visit to the screen.
staffUserSchema.index({ createdAt: -1 });

export type StaffUserDocument = HydratedDocument<StaffUserAttributes>;
export const StaffUserModel = model<StaffUserAttributes>('StaffUser', staffUserSchema);
