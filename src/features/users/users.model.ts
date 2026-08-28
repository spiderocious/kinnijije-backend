import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';
import {
  ALL_DIFFICULTIES,
  ALL_ROLES,
  ALL_STATUSES,
  DIFFICULTIES,
  USER_ROLES,
  USER_STATUSES,
  type Difficulty,
  type UserRole,
  type UserStatus,
} from '@shared/constants/roles.js';

/**
 * `_id` is our own prefixed ULID string rather than an ObjectId: ids appear in
 * URLs and logs, and a sortable, self-describing id is worth more there than a
 * BSON-native one.
 */
const userSchema = new Schema(
  {
    _id: { type: String, default: () => newId('user') },

    email: {
      type: String,
      required: true,
      // Stored lowercase and trimmed so the unique index is genuinely
      // case-insensitive. "A@b.com" and "a@b.com" must not be two accounts.
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    // `select: false` keeps the hash out of every query result by default, so
    // it cannot leak into a response through a forgotten projection. The auth
    // repo opts back in explicitly where it needs to verify.
    passwordHash: { type: String, required: true, select: false },

    name: { type: String, required: true, trim: true, maxlength: 120 },

    role: { type: String, required: true, enum: ALL_ROLES, default: USER_ROLES.USER, index: true },

    status: {
      type: String,
      required: true,
      enum: ALL_STATUSES,
      default: USER_STATUSES.PENDING,
      index: true,
    },

    emailVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },

    /**
     * Failed-login tracking for lockout. Kept on the user rather than in the
     * rate limiter because it must survive a process restart — an attacker
     * should not be able to reset the counter by waiting for a redeploy.
     */
    failedLoginCount: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },

    /** Reason an admin gave when suspending or banning. Shown in admin tooling. */
    statusReason: { type: String, default: null },

    /**
     * When the person finished setting up. Null means they still owe us
     * onboarding, and the SERVER is the authority on that — the client must
     * never decide for itself whether to show onboarding, or a cleared browser
     * would replay it forever.
     */
    onboardingCompletedAt: { type: Date, default: null },

    /**
     * Taste preferences. Defaults are load-bearing: the PRD requires Nigerian
     * and West African to be first-class, so someone who answers nothing still
     * gets the product's point of view rather than a generic one.
     */
    prefs: {
      type: new Schema(
        {
          cuisines: { type: [String], default: ['Nigerian', 'West African'] },
          difficulty: {
            type: String,
            enum: ALL_DIFFICULTIES,
            default: DIFFICULTIES.ANYTHING,
          },
          measurement: { type: String, enum: ['metric', 'imperial'], default: 'metric' },
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    /**
     * What the cook said was in their kitchen during onboarding.
     *
     * Deliberately a plain list, not a pantry: the standing kitchen with counts
     * and locations is its own feature. This is only the first answer to "what
     * do you have", so the first suggestion has something to work with.
     */
    kitchenItems: { type: [String], default: [] },

    /**
     * Ingredients this cook has used before, most recent first.
     *
     * Feeds "pick from recent" so a returning cook does not retype the same
     * six things every session. Capped when written — an unbounded list would
     * grow forever and the tail is never shown anyway.
     */
    recentIngredients: { type: [String], default: [] },

    /**
     * Where they are. Drives the weather that shapes an answer — a hot
     * afternoon and a rainy night call for different food.
     */
    city: { type: String, default: null },
    country: { type: String, default: null },

    /** What we may send. Off by default — nobody opted into being messaged. */
    notifications: {
      type: new Schema(
        {
          // Split from one `lowStockNudges` flag, because these three ask
          // very different things of a person. "You are out of rice" is
          // useful; "have you eaten?" is personal, and lumping them together
          // meant turning off the first also turned off the third — or worse,
          // kept it on.
          runningLow: { type: Boolean, default: false },
          useItUp: { type: Boolean, default: false },
          haveYouEaten: { type: Boolean, default: false },
          dailyDigest: { type: Boolean, default: false },
          weeklySummary: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'users',
  },
);

// Sorted listing and cursor pagination both walk this index.
userSchema.index({ createdAt: -1, _id: -1 });

/**
 * The document shape is declared explicitly rather than taken from
 * `InferSchemaType`. Inference marks every field with a schema default as
 * optional (`lastLoginAt?: Date | null`), which under
 * `exactOptionalPropertyTypes` is a different type from `Date | null` — so an
 * inferred document will not pass where a mapper expects the plain shape.
 * The schema above guarantees these are always present on a loaded document.
 */
export interface UserPrefs {
  cuisines: string[];
  difficulty: Difficulty;
  measurement: 'metric' | 'imperial';
}

export interface UserAttributes {
  _id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  statusReason: string | null;
  onboardingCompletedAt: Date | null;
  prefs: UserPrefs;
  kitchenItems: string[];
  recentIngredients: string[];
  city: string | null;
  country: string | null;
  notifications: {
    runningLow: boolean;
    useItUp: boolean;
    haveYouEaten: boolean;
    dailyDigest: boolean;
    weeklySummary: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<UserAttributes>;

export const UserModel = model<UserAttributes>('User', userSchema);
