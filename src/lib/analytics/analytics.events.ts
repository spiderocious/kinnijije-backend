/**
 * Every server event name, in one place.
 *
 * The names live here so a typo cannot invent a second event: a provider will
 * accept `ai_call_completd` forever and never mention it. snake_case, past
 * tense, object first — see docs/v2/analytics.
 */
export const SERVER_EVENTS = {
  // AI / LLM
  AI_CALL_COMPLETED: 'ai_call_completed',
  AI_CALL_FAILED: 'ai_call_failed',
  AI_FALLBACK_SERVED: 'ai_fallback_served',
  AI_IMAGE_GENERATED: 'ai_image_generated',
  AI_TRANSCRIPTION_COMPLETED: 'ai_transcription_completed',
  AI_EXTRACTION_REVIEWED: 'ai_extraction_reviewed',

  // Errors and limits
  API_ERROR_RETURNED: 'api_error_returned',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  UPSTREAM_FAILURE: 'upstream_failure',
  ANONYMOUS_ABUSE_SUSPECTED: 'anonymous_abuse_suspected',

  // Public surface
  DECIDE_SERVED: 'decide_served',
  DECIDE_OPTIONS_SERVED: 'decide_options_served',

  // Auth and accounts
  USER_REGISTERED: 'user_registered',
  AUTH_ATTEMPT_FAILED: 'auth_attempt_failed',
  TOKEN_REFRESHED: 'token_refreshed',
  ACCOUNT_STATUS_CHANGED: 'account_status_changed',
  ACCOUNT_DELETED_SERVER: 'account_deleted_server',

  // Jobs
  JOB_COMPLETED: 'job_completed',
  JOB_FAILED: 'job_failed',
  JOB_CANCELLED: 'job_cancelled',

  // Email
  EMAIL_SENT: 'email_sent',
  EMAIL_FAILED: 'email_failed',
  NOTIFICATION_SUPPRESSED: 'notification_suppressed',
} as const;

export type ServerEvent = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];
