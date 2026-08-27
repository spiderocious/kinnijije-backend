/**
 * Roles answer "what kind of account is this?" — a stable capability tier.
 * Statuses answer "may this account act right now?" — a lifecycle position.
 * They gate independently: an admin who is suspended is still an admin, and
 * must still be refused.
 */
export const USER_ROLES = {
  USER: 'user',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const ALL_ROLES: readonly UserRole[] = Object.values(USER_ROLES);

/**
 * Rank exists so a route can say "moderator or above" without listing every
 * role above it — a new role slots in without touching every route.
 */
const ROLE_RANK: Record<UserRole, number> = {
  [USER_ROLES.USER]: 0,
  [USER_ROLES.MODERATOR]: 1,
  [USER_ROLES.ADMIN]: 2,
  [USER_ROLES.SUPER_ADMIN]: 3,
};

export const roleAtLeast = (role: UserRole, minimum: UserRole): boolean =>
  ROLE_RANK[role] >= ROLE_RANK[minimum];

export const USER_STATUSES = {
  /** Registered, email not yet confirmed. Can read; cannot write. */
  PENDING: 'pending',
  ACTIVE: 'active',
  /** Temporary, reversible restriction. */
  SUSPENDED: 'suspended',
  /** Permanent. Cannot authenticate at all. */
  BANNED: 'banned',
  /** Soft-deleted. Cannot authenticate. */
  DELETED: 'deleted',
} as const;

export type UserStatus = (typeof USER_STATUSES)[keyof typeof USER_STATUSES];

export const ALL_STATUSES: readonly UserStatus[] = Object.values(USER_STATUSES);

/**
 * Statuses that may hold a session at all. A banned or deleted account is
 * refused at authentication, before any permission question is asked.
 */
export const SESSION_ALLOWED_STATUSES: readonly UserStatus[] = [
  USER_STATUSES.PENDING,
  USER_STATUSES.ACTIVE,
  USER_STATUSES.SUSPENDED,
];

/**
 * The application owns the transition map; the schema only owns the type.
 * A status arriving from a client is untrusted until checked against this.
 */
const VALID_STATUS_TRANSITIONS: Record<UserStatus, readonly UserStatus[]> = {
  [USER_STATUSES.PENDING]: [USER_STATUSES.ACTIVE, USER_STATUSES.BANNED, USER_STATUSES.DELETED],
  [USER_STATUSES.ACTIVE]: [USER_STATUSES.SUSPENDED, USER_STATUSES.BANNED, USER_STATUSES.DELETED],
  [USER_STATUSES.SUSPENDED]: [USER_STATUSES.ACTIVE, USER_STATUSES.BANNED, USER_STATUSES.DELETED],
  [USER_STATUSES.BANNED]: [USER_STATUSES.ACTIVE, USER_STATUSES.DELETED],
  [USER_STATUSES.DELETED]: [],
};

export const isValidStatusTransition = (from: UserStatus, to: UserStatus): boolean =>
  VALID_STATUS_TRANSITIONS[from].includes(to);

/**
 * How adventurous a cook says they are. Sets the floor for what gets
 * suggested — `anything` means no filter at all.
 */
export const DIFFICULTIES = {
  EASY: 'easy',
  MEDIUM: 'medium',
  ANYTHING: 'anything',
} as const;

export type Difficulty = (typeof DIFFICULTIES)[keyof typeof DIFFICULTIES];

export const ALL_DIFFICULTIES: readonly Difficulty[] = Object.values(DIFFICULTIES);

/**
 * The cuisines offered at onboarding. Nigerian and West African lead, and are
 * the default — that ordering is the product's point of view, not an accident.
 */
export const CUISINE_OPTIONS: readonly string[] = [
  'Nigerian',
  'West African',
  'Asian',
  'Mediterranean',
  'Comfort food',
  'Continental',
];
