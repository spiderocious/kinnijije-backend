/**
 * Rate limits as named policies. A bare pair of numbers at a route says
 * nothing about intent; LOGIN does.
 *
 * `capacity` is the burst a client may spend at once. `refillPerSec` is the
 * sustained rate it earns back. Expressed as "N per window" for readability.
 */
export interface RateLimitPolicy {
  readonly name: string;
  readonly capacity: number;
  readonly refillPerSec: number;
}

const perWindow = (name: string, count: number, windowSeconds: number): RateLimitPolicy => ({
  name,
  capacity: count,
  refillPerSec: count / windowSeconds,
});

const MINUTE = 60;
const QUARTER_HOUR = 15 * MINUTE;
const HOUR = 60 * MINUTE;

export const RATE_LIMITS = {
  /**
   * The blanket limit every request passes through, keyed by IP. Generous —
   * it is a backstop against a runaway client, not the real protection. The
   * per-route policies below are what actually guard expensive endpoints.
   *
   * Raised with the rest: a client watching a job polls this endpoint
   * repeatedly, and the blanket limit must not be what stops it.
   */
  GLOBAL: perWindow('global', 900, MINUTE),

  /**
   * Credential-guessing is the threat; keyed by IP *and* by email.
   *
   * DELIBERATELY NOT RAISED. Nothing polls login, so the poll-driven reason
   * for loosening the others does not apply — and this is the one limit whose
   * whole job is to be tight.
   */
  LOGIN: perWindow('login', 10, QUARTER_HOUR),

  /**
   * Registration is cheap to abuse and expensive to us (argon2 + an email).
   * Not raised, for the same reason as LOGIN.
   */
  REGISTER: perWindow('register', 5, HOUR),

  /** Refresh is legitimate and frequent, but not unbounded. */
  REFRESH: perWindow('refresh', 180, QUARTER_HOUR),

  /**
   * Sends a real email through Resend — abuse costs money and reputation.
   * Not raised: the cost here is external and reputational, not compute.
   */
  PASSWORD_RESET: perWindow('password_reset', 5, HOUR),

  /** Ordinary authenticated reads. */
  AUTHENTICATED_READ: perWindow('authenticated_read', 360, MINUTE),

  /** Authenticated writes: rarer than reads, more expensive when abused. */
  AUTHENTICATED_WRITE: perWindow('authenticated_write', 90, MINUTE),

  /**
   * Job status polling. Its own policy because a single extraction can spend
   * a dozen requests on its own, and sharing AUTHENTICATED_READ meant one
   * long read could exhaust the budget for every other screen.
   */
  JOB_POLL: perWindow('job_poll', 600, MINUTE),

  /**
   * Anything that costs a model call.
   *
   * Chat and extraction previously borrowed PASSWORD_RESET purely because it
   * was tight — which capped somebody at FIVE chat messages an hour and made
   * the limit read as though sending an email were involved. A named policy
   * states the real reason: each of these spends money at OpenAI.
   */
  AI_CALL: perWindow('ai_call', 60, HOUR),

  /**
   * The anonymous decision. UNAUTHENTICATED *and* it can spend money at
   * OpenAI — the worst pair in the system.
   *
   * Deliberately NOT AI_CALL: that policy keys by identity, and on a public
   * route `byIdentity` falls through to IP anyway while reading as though a
   * user were involved. A separate name states that this bucket guards a
   * surface with no account behind it.
   *
   * 8 an hour is generous for a real person — who needs one, maybe three on a
   * fussy day, and whose "not this" retries cost nothing — and useless to a
   * scraper.
   */
  DECIDE_ANON: perWindow('decide_anon', 8, HOUR),

  /**
   * The tiles. In-memory, no database, no model — cheap enough to be generous,
   * bounded so it cannot become a DoS lever.
   */
  DECIDE_OPTIONS: perWindow('decide_options', 120, MINUTE),

  /** Admin tooling is trusted but still bounded against a broken script. */
  ADMIN: perWindow('admin', 600, MINUTE),

  /**
   * Operator-triggered image generation.
   *
   * Trusted but costly: an image call is worth roughly ten to forty text ones,
   * so the blanket ADMIN policy is far too loose. This bounds a stuck retry
   * loop in the console, not a person — nobody generates sixty images an hour
   * by hand.
   */
  IMAGE_GENERATE: perWindow('image_generate', 60, HOUR),
} as const;
