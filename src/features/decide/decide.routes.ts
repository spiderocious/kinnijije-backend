import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { byIp, rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { decideController } from './decide.controller.js';
import { DecideSchema } from './decide.schema.js';

const router = Router();

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

// The expensive one: unauthenticated AND it can spend money at OpenAI.
router.post(
  '/decide',
  rateLimit(RATE_LIMITS.DECIDE_ANON, byIp),
  validate(DecideSchema),
  asyncHandler(decideController.decide),
);

export function register(app: Express): void {
  app.use('/api/v1', router);
}
