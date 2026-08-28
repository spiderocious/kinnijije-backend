import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { extractionController, StartExtractionSchema } from './extraction.controller.js';

const router = Router();
const ALLOWED = [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] as const;

// Every one of these costs money per call, so they sit on the tighter policy.
router.post('/extraction/check', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AI_CALL), validate(StartExtractionSchema), asyncHandler(extractionController.checkPhotos));
router.post('/extraction/photos', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AI_CALL), validate(StartExtractionSchema), asyncHandler(extractionController.extractPhotos));
router.post('/extraction/receipt', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AI_CALL), validate(StartExtractionSchema), asyncHandler(extractionController.extractReceipt));

export function register(app: Express): void {
  app.use('/api/v1', router);
}
