import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { optionalAuthenticate } from '@shared/middleware/authenticate.middleware.js';
import { byIp, rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { askController } from './ask.controller.js';
import { CreateTurnSchema, FollowUpSchema, UploadTicketSchema } from './ask.schema.js';
import { streamTurn } from './ask.sse.js';

const router = Router();

/**
 * Ask KinniJije.
 *
 * PUBLIC, like the decide flow it feeds — the whole point is that a stranger
 * can use it. `byIp` is passed explicitly rather than relying on the default
 * resolver: `byIdentity` falls back to IP when there is no session, which reads
 * as though a user were involved. On a route that is public by design the key
 * must say so at the callsite.
 *
 * `optionalAuthenticate` so a signed-in cook's session carries their id and
 * their history still attaches. A bad token is still rejected; only absence is
 * tolerated.
 */

router.post(
  '/ask/sessions',
  optionalAuthenticate,
  rateLimit(RATE_LIMITS.ASK_SESSION, byIp),
  asyncHandler(askController.start),
);

router.get(
  '/ask/sessions/:sessionId',
  rateLimit(RATE_LIMITS.ASK_TURN, byIp),
  asyncHandler(askController.session),
);

// The most expensive thing a stranger can trigger: every ticket becomes a
// transcription. Its own, tighter policy.
router.post(
  '/ask/sessions/:sessionId/upload-url',
  rateLimit(RATE_LIMITS.ASK_UPLOAD, byIp),
  validate(UploadTicketSchema),
  asyncHandler(askController.uploadTicket),
);

router.post(
  '/ask/sessions/:sessionId/turns',
  rateLimit(RATE_LIMITS.ASK_TURN, byIp),
  validate(CreateTurnSchema),
  asyncHandler(askController.createTurn),
);

/**
 * Follow-ups. Its own policy, because each one is a model call.
 *
 * The per-session cap in the service is the real limit; this bounds how fast
 * somebody can burn through it, and how many sessions one address can spend.
 */
router.post(
  '/ask/sessions/:sessionId/follow-up',
  rateLimit(RATE_LIMITS.ASK_FOLLOW_UP, byIp),
  validate(FollowUpSchema),
  asyncHandler(askController.followUp),
);

// Registered BEFORE the stream route: both match `/turns/:turnId`, and a
// literal suffix must not be shadowed by the shorter path.
router.get(
  '/ask/sessions/:sessionId/turns/:turnId',
  rateLimit(RATE_LIMITS.ASK_TURN, byIp),
  asyncHandler(askController.turn),
);

/**
 * The live one.
 *
 * Deliberately NOT rate-limited on the same policy as a turn: a stream is one
 * connection held open rather than repeated work, and counting it against the
 * turn budget would punish the client for using the cheaper transport. The
 * stream itself is capped at 90 seconds.
 */
router.get('/ask/sessions/:sessionId/turns/:turnId/stream', asyncHandler(streamTurn));

export function register(app: Express): void {
  app.use('/api/v1', router);
}
