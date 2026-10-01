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
  GLOBAL: perWindow('global', 2700, MINUTE),

  /**
   * Credential-guessing is the threat; keyed by IP *and* by email.
   *
   * Raised to 30 per quarter-hour. This is still the tightest policy in the
   * system and still the one whose whole job is to be tight: 30 attempts in
   * fifteen minutes is generous for somebody who has forgotten which password
   * they used, and far below what a credential-stuffing run needs to be worth
   * attempting. The email key matters more than the IP one here, since it
   * bounds attempts against a single account however many addresses they come
   * from.
   */
  LOGIN: perWindow('login', 30, QUARTER_HOUR),

  /**
   * Registration is cheap to abuse and expensive to us (argon2 + an email).
   *
   * Raised to 15 an hour. Still low enough that bulk signup from one address
   * is not practical, and well above what a shared office or a family on one
   * connection would ever need.
   */
  REGISTER: perWindow('register', 15, HOUR),

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
   * 24 an hour leaves room for somebody genuinely undecided — changing an
   * answer and deciding again costs a fresh call each time — while staying far
   * below what makes scraping the catalogue through this route worthwhile.
   *
   * It is the one raised policy that can spend money at OpenAI, so it is worth
   * watching: the decide dashboard's cost panel is where that would show.
   */
  DECIDE_ANON: perWindow('decide_anon', 24, HOUR),

  /**
   * The tiles. In-memory, no database, no model — cheap enough to be generous,
   * bounded so it cannot become a DoS lever.
   */
  DECIDE_OPTIONS: perWindow('decide_options', 120, MINUTE),

  /**
   * The SAME decision, made by somebody signed in.
   *
   * Keyed by user id rather than IP, so a household or an office behind one
   * address no longer shares a bucket — which is the case DECIDE_ANON gets
   * wrong for exactly the people who have bothered to make an account.
   *
   * Looser, because the abuse case is different: a scraper does not sign up,
   * and an account can be suspended, which an IP cannot.
   */
  DECIDE_USER: perWindow('decide_user', 40, HOUR),

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

  /**
   * Chowdeck offers for one meal in one place.
   *
   * Mostly served from our cache, but a miss becomes a call to somebody
   * else's API with no key and no contract — so this is tighter than an
   * ordinary read. A person looks at a handful of meals; thirty a minute is
   * room for "not this" and changing places, and useless for scraping.
   */
  CHOWDECK_OFFERS: perWindow('chowdeck_offers', 30, MINUTE),

  /** A tap through to Chowdeck, reported by the browser. Never calls them — a lookup and an insert. */
  CHOWDECK_CLICK: perWindow('chowdeck_click', 60, MINUTE),

  /** Searching OUR saved places. No call to Chowdeck, but still a database query per keystroke. */
  PLACES_SEARCH: perWindow('places_search', 60, MINUTE),

  /** Console reads for the Chowdeck pages. Tighter than ADMIN: some return whole response bodies. */
  CHOWDECK_ADMIN_READ: perWindow('chowdeck_admin_read', 120, MINUTE),

  /**
   * Console actions that can reach Chowdeck or wipe state: a location search,
   * a replay, a fetch-ahead, a cache clear. Bounds a stuck click loop, not a
   * person.
   */
  CHOWDECK_ADMIN_ACTION: perWindow('chowdeck_admin_action', 10, MINUTE),
} as const;
