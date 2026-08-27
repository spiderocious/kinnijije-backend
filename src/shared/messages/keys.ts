/**
 * Message keys, sliced per feature. Responses never carry an inline human
 * string — copy lives in one reviewable place so it can change without a
 * client breaking, and so it can be localised later.
 */
export const MESSAGE_KEYS = {
  auth: {
    REGISTERED: 'auth.registered',
    LOGIN_SUCCESS: 'auth.login_success',
    LOGGED_OUT: 'auth.logged_out',
    TOKEN_REFRESHED: 'auth.token_refreshed',
    INVALID_CREDENTIALS: 'auth.invalid_credentials',
    EMAIL_EXISTS: 'auth.email_exists',
    TOKEN_INVALID: 'auth.token_invalid',
    TOKEN_EXPIRED: 'auth.token_expired',
    SESSION_REVOKED: 'auth.session_revoked',
    UNAUTHENTICATED: 'auth.unauthenticated',
    ACCOUNT_LOCKED: 'auth.account_locked',
    PASSWORD_CHANGED: 'auth.password_changed',
  },
  users: {
    PROFILE_FETCHED: 'users.profile_fetched',
    PROFILE_UPDATED: 'users.profile_updated',
    LIST_FETCHED: 'users.list_fetched',
    STATUS_UPDATED: 'users.status_updated',
    ROLE_UPDATED: 'users.role_updated',
    NOT_FOUND: 'users.not_found',
    CANNOT_DEMOTE_SELF: 'users.cannot_demote_self',
  },
  access: {
    FORBIDDEN: 'access.forbidden',
    INSUFFICIENT_ROLE: 'access.insufficient_role',
    ACCOUNT_SUSPENDED: 'access.account_suspended',
    ACCOUNT_BANNED: 'access.account_banned',
    ACCOUNT_DELETED: 'access.account_deleted',
    ACCOUNT_PENDING_VERIFICATION: 'access.account_pending_verification',
  },
  files: {
    UPLOAD_READY: 'files.upload_ready',
    UPLOAD_CONFIRMED: 'files.upload_confirmed',
    LIST_FETCHED: 'files.list_fetched',
    NOT_FOUND: 'files.not_found',
    NOT_UPLOADED: 'files.not_uploaded',
    STORAGE_UNAVAILABLE: 'files.storage_unavailable',
  },
  onboarding: {
    FETCHED: 'onboarding.fetched',
    SAVED: 'onboarding.saved',
    COMPLETED: 'onboarding.completed',
    ALREADY_COMPLETED: 'onboarding.already_completed',
  },
  common: {
    VALIDATION_ERROR: 'common.validation_error',
    MALFORMED_JSON: 'common.malformed_json',
    RATE_LIMITED: 'common.rate_limited',
    NOT_FOUND: 'common.not_found',
    INTERNAL: 'common.internal',
    UPSTREAM_FAILURE: 'common.upstream_failure',
    HEALTHY: 'common.healthy',
  },
} as const;

/**
 * Flattens the nested registry into the union of every leaf value.
 *
 * The indexed access must be distributed over the slice union explicitly:
 * `Slice[keyof Slice]` collapses to `never`, because `keyof` over a union
 * yields only the keys common to every member — and these slices share none.
 */
type Leaves<T> = T extends Record<string, infer V> ? V : never;

export type MessageKey = Leaves<(typeof MESSAGE_KEYS)[keyof typeof MESSAGE_KEYS]>;
