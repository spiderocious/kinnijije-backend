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
   */
  GLOBAL: perWindow('global', 300, MINUTE),

  /** Credential-guessing is the threat; keyed by IP *and* by email. */
  LOGIN: perWindow('login', 10, QUARTER_HOUR),

  /** Registration is cheap to abuse and expensive to us (argon2 + an email). */
  REGISTER: perWindow('register', 5, HOUR),

  /** Refresh is legitimate and frequent, but not unbounded. */
  REFRESH: perWindow('refresh', 60, QUARTER_HOUR),

  /** Sends a real email through Resend — abuse costs money and reputation. */
  PASSWORD_RESET: perWindow('password_reset', 5, HOUR),

  /** Ordinary authenticated reads. */
  AUTHENTICATED_READ: perWindow('authenticated_read', 120, MINUTE),

  /** Authenticated writes: rarer than reads, more expensive when abused. */
  AUTHENTICATED_WRITE: perWindow('authenticated_write', 30, MINUTE),

  /** Admin tooling is trusted but still bounded against a broken script. */
  ADMIN: perWindow('admin', 200, MINUTE),
} as const;
