import { Router, type Express } from 'express';

import { flagsService } from '@lib/flags/index.js';
import { ResponseUtil } from '@lib/response.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';

const router = Router();

/**
 * What the app is allowed to show.
 *
 * PUBLIC and unauthenticated: the landing page and the sign-in screens read it
 * too, and gating it behind a session would mean a flag could not switch off
 * anything a signed-out person sees.
 *
 * It carries only booleans — no labels, no reasons, no operator names. Those
 * belong to the console, behind the role check.
 *
 * Versioned, unlike the health probes: this IS API surface, and a client that
 * reads it should break loudly if the shape ever moves.
 */
router.get(
  '/config/features',
  asyncHandler(async (_req, res) => {
    ResponseUtil.ok(res, await flagsService.state());
  }),
);

export function register(app: Express): void {
  app.use('/api/v1', router);
}
