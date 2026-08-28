import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { kitchenController } from './kitchen.controller.js';
import { SaveKitchenSchema } from './kitchen.schema.js';

const router = Router();

// A pending account reaches the kitchen straight after onboarding, so it must
// be able to read AND write here — this is the screen onboarding lands on.
const KITCHEN_STATUSES = [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] as const;

router.get(
  '/kitchen',
  authenticate,
  requireStatus(...KITCHEN_STATUSES),
  rateLimit(RATE_LIMITS.AUTHENTICATED_READ),
  asyncHandler(kitchenController.get),
);

router.put(
  '/kitchen',
  authenticate,
  requireStatus(...KITCHEN_STATUSES),
  rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE),
  validate(SaveKitchenSchema),
  asyncHandler(kitchenController.save),
);

export function register(app: Express): void {
  app.use('/api/v1', router);
}
