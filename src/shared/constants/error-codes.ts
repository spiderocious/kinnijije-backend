/**
 * Stable, machine-readable identities. This is the client contract: clients
 * `switch` on these and on nothing else. Renaming one is a breaking change.
 *
 * Never an inline string at a callsite, and never an HTTP status number.
 */
export const ERROR_CODES = {
  // Auth
  INVALID_CREDENTIALS: 'invalid_credentials',
  EMAIL_EXISTS: 'email_exists',
  TOKEN_INVALID: 'token_invalid',
  TOKEN_EXPIRED: 'token_expired',
  SESSION_REVOKED: 'session_revoked',
  UNAUTHENTICATED: 'unauthenticated',
  ACCOUNT_LOCKED: 'account_locked',

  // Authorization — role and status gating
  FORBIDDEN: 'forbidden',
  INSUFFICIENT_ROLE: 'insufficient_role',
  ACCOUNT_SUSPENDED: 'account_suspended',
  ACCOUNT_BANNED: 'account_banned',
  ACCOUNT_DELETED: 'account_deleted',
  ACCOUNT_PENDING_VERIFICATION: 'account_pending_verification',

  // Resources
  NOT_FOUND: 'not_found',
  ALREADY_EXISTS: 'already_exists',

  // Files
  FILE_NOT_UPLOADED: 'file_not_uploaded',
  STORAGE_UNAVAILABLE: 'storage_unavailable',

  // Onboarding
  ONBOARDING_ALREADY_COMPLETED: 'onboarding_already_completed',

  // Request issues
  VALIDATION_ERROR: 'validation_error',
  MALFORMED_JSON: 'malformed_json',
  RATE_LIMITED: 'rate_limited',

  // Server / upstream
  INTERNAL: 'internal',
  UPSTREAM_FAILURE: 'upstream_failure',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Severity bands answer one question: *should this page someone?* They are
 * coarse by design and can never identify an error — that is what the stable
 * identity above is for. Clients must not branch on these.
 *
 * `SUSPICIOUS_VALIDATION` is the band people miss: validation that should not
 * happen from a well-behaved client (a stale identifier, a role mismatch) means
 * a client bug or tampering, not a user typo. Both fail validation; only one is
 * worth investigating.
 */
export const SEVERITY = {
  BODY_VALIDATION: 10,
  SUSPICIOUS_VALIDATION: 20,
  AUTH: 30,
  FORBIDDEN: 40,
  NOT_FOUND: 50,
  CONFLICT: 60,
  BUSINESS_RULE: 70,
  RATE_LIMITED: 80,
  UPSTREAM: 90,
  SERVER_FAULT: 100,
} as const;

export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];

const SEVERITY_BY_CODE: Record<ErrorCode, Severity> = {
  [ERROR_CODES.INVALID_CREDENTIALS]: SEVERITY.AUTH,
  [ERROR_CODES.EMAIL_EXISTS]: SEVERITY.CONFLICT,
  [ERROR_CODES.TOKEN_INVALID]: SEVERITY.AUTH,
  [ERROR_CODES.TOKEN_EXPIRED]: SEVERITY.AUTH,
  [ERROR_CODES.SESSION_REVOKED]: SEVERITY.AUTH,
  [ERROR_CODES.UNAUTHENTICATED]: SEVERITY.AUTH,
  [ERROR_CODES.ACCOUNT_LOCKED]: SEVERITY.BUSINESS_RULE,

  [ERROR_CODES.FORBIDDEN]: SEVERITY.FORBIDDEN,
  // A client that asks for an endpoint its role cannot reach is a client bug,
  // not a typo — worth telling apart from ordinary validation noise.
  [ERROR_CODES.INSUFFICIENT_ROLE]: SEVERITY.SUSPICIOUS_VALIDATION,
  [ERROR_CODES.ACCOUNT_SUSPENDED]: SEVERITY.FORBIDDEN,
  [ERROR_CODES.ACCOUNT_BANNED]: SEVERITY.FORBIDDEN,
  [ERROR_CODES.ACCOUNT_DELETED]: SEVERITY.FORBIDDEN,
  [ERROR_CODES.ACCOUNT_PENDING_VERIFICATION]: SEVERITY.FORBIDDEN,

  [ERROR_CODES.FILE_NOT_UPLOADED]: SEVERITY.BUSINESS_RULE,
  [ERROR_CODES.STORAGE_UNAVAILABLE]: SEVERITY.UPSTREAM,
  [ERROR_CODES.ONBOARDING_ALREADY_COMPLETED]: SEVERITY.CONFLICT,

  [ERROR_CODES.NOT_FOUND]: SEVERITY.NOT_FOUND,
  [ERROR_CODES.ALREADY_EXISTS]: SEVERITY.CONFLICT,

  [ERROR_CODES.VALIDATION_ERROR]: SEVERITY.BODY_VALIDATION,
  [ERROR_CODES.MALFORMED_JSON]: SEVERITY.BODY_VALIDATION,
  [ERROR_CODES.RATE_LIMITED]: SEVERITY.RATE_LIMITED,

  [ERROR_CODES.INTERNAL]: SEVERITY.SERVER_FAULT,
  [ERROR_CODES.UPSTREAM_FAILURE]: SEVERITY.UPSTREAM,
};

export const severityFor = (code: ErrorCode): Severity => SEVERITY_BY_CODE[code];
