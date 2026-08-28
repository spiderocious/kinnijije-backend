import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';

import { jobsController } from './jobs.controller.js';

const router = Router();

const JOB_STATUSES_ALLOWED = [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] as const;

/**
 * ROUTE ORDER IS LOAD-BEARING: `/jobs` before `/jobs/:jobId`, and every literal
 * sub-path (`/stream`, `/cancel`, `/retry`) before the bare parameter route.
 */

router.get(
  '/jobs',
  authenticate,
  requireStatus(...JOB_STATUSES_ALLOWED),
  rateLimit(RATE_LIMITS.AUTHENTICATED_READ),
  asyncHandler(jobsController.list),
);

router.get(
  '/jobs/:jobId/stream',
  authenticate,
  requireStatus(...JOB_STATUSES_ALLOWED),
  // Deliberately NOT rate limited on the read policy: a stream is one long
  // request, and counting it against a per-minute budget would refuse a second
  // photo being watched.
  asyncHandler(jobsController.stream),
);

router.post(
  '/jobs/:jobId/cancel',
  authenticate,
  requireStatus(...JOB_STATUSES_ALLOWED),
  rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE),
  asyncHandler(jobsController.cancel),
);

router.post(
  '/jobs/:jobId/retry',
  authenticate,
  requireStatus(...JOB_STATUSES_ALLOWED),
  rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE),
  asyncHandler(jobsController.retry),
);

router.get(
  '/jobs/:jobId',
  authenticate,
  requireStatus(...JOB_STATUSES_ALLOWED),
  // Polling is the fallback for anyone who cannot hold an SSE connection, so
  // this needs headroom well above ordinary reads — which is what JOB_POLL is
  // for. It used to say this while sitting on the ordinary read policy.
  rateLimit(RATE_LIMITS.JOB_POLL),
  asyncHandler(jobsController.get),
);

export function register(app: Express): void {
  app.use('/api/v1', router);
}
