import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { onboardingController } from './onboarding.controller.js';
import { SaveOnboardingSchema } from './onboarding.schema.js';

const router = Router();

/**
 * Onboarding is the ONE write surface a `pending` account must be able to use.
 *
 * A new account is created `pending`, and onboarding is what it does first —
 * gating these on `active` would deadlock every new user out of the product.
 * That is why the status list here is wider than on any other write route.
 */
const ONBOARDING_STATUSES = [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] as const;

// Registered before `/onboarding` so the literal path is not shadowed.
router.post(
  '/onboarding/complete',
  authenticate,
  requireStatus(...ONBOARDING_STATUSES),
  rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE),
  asyncHandler(onboardingController.complete),
);

router.get(
  '/onboarding',
  authenticate,
  requireStatus(...ONBOARDING_STATUSES),
  rateLimit(RATE_LIMITS.AUTHENTICATED_READ),
  asyncHandler(onboardingController.get),
);

router.patch(
  '/onboarding',
  authenticate,
  requireStatus(...ONBOARDING_STATUSES),
  rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE),
  validate(SaveOnboardingSchema),
  asyncHandler(onboardingController.save),
);

export function register(app: Express): void {
  app.use('/api/v1', router);
}
