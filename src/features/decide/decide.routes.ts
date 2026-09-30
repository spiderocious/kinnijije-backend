import { Router, type Express, type RequestHandler } from 'express';

import { getContext } from '@lib/http/request-context.js';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { byIp, rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { authenticate, optionalAuthenticate } from '@shared/middleware/authenticate.middleware.js';

import { decideController } from './decide.controller.js';
import { DecideSchema } from './decide.schema.js';

const router = Router();

/**
 * Picks the bucket from whether a session was presented.
 *
 * Two limiters rather than one with a clever resolver: the policies differ in
 * both key and rate, and a single `rateLimit` call cannot express that.
 */
const anonLimiter = rateLimit(RATE_LIMITS.DECIDE_ANON, byIp);
const userLimiter = rateLimit(RATE_LIMITS.DECIDE_USER);

const decideRateLimit: RequestHandler = (req, res, next) => {
  const handler = getContext()?.user_id === undefined ? anonLimiter : userLimiter;
  handler(req, res, next);
};

/**
 * PUBLIC and unauthenticated, both of them.
 *
 * `byIp` is passed explicitly rather than relying on the default resolver:
 * `byIdentity` falls back to IP only when there is no session, which reads as
 * though a user were involved. On a route that is public by design, the key
 * must say so at the callsite — the same reasoning app.ts uses for the global
 * backstop.
 */

// Literal, and registered first. Cheap: in-memory, no database, no model.
router.get(
  '/decide/options',
  rateLimit(RATE_LIMITS.DECIDE_OPTIONS, byIp),
  // Not wrapped in asyncHandler: it is synchronous and cannot reject, and the
  // wrapper's type demands a promise.
  decideController.options,
);

// Counters for the landing page. Cheap: a cached snapshot, recomputed at most
// once every three hours however hard this is hit.
router.get(
  '/decide/stats',
  rateLimit(RATE_LIMITS.DECIDE_OPTIONS, byIp),
  asyncHandler(decideController.stats),
);

/**
 * The expensive one: it can spend money at OpenAI.
 *
 * OPTIONALLY authenticated. A guest is keyed by IP on the tight anonymous
 * policy; somebody signed in is keyed by user id on a looser one, because a
 * household behind one address should not share a stranger's bucket. Both hit
 * the same handler — the only difference is which bucket and whose kitchen.
 */
router.post(
  '/decide',
  optionalAuthenticate,
  decideRateLimit,
  validate(DecideSchema),
  asyncHandler(decideController.decide),
);

/**
 * History. AUTHENTICATED, and the only part of this feature that is.
 *
 * Registered after `/decide/options` and `/decide/stats` for the same reason
 * they come first: a literal path must not be shadowed by a parameterised one.
 * `/decide/history/:id` is literal-prefixed so there is no conflict either way.
 */
router.get('/decide/history', authenticate, asyncHandler(decideController.history));
router.get('/decide/history/:id', authenticate, asyncHandler(decideController.historyEntry));
router.delete(
  '/decide/history/:id',
  authenticate,
  asyncHandler(decideController.removeHistoryEntry),
);

export function register(app: Express): void {
  app.use('/api/v1', router);
}
