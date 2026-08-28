import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';

import { insightsController } from './insights.controller.js';

const router = Router();
const ALLOWED = [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] as const;

// Literal before parameterised — and /week/reading before /week would be wrong
// here since /week has no parameter, but the order is kept explicit anyway.
router.get('/week', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(insightsController.week));
router.post('/week/reading', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), asyncHandler(insightsController.refreshReading));

export function register(app: Express): void {
  app.use('/api/v1', router);
}
