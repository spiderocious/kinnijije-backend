import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { marketController } from './market.controller.js';
import { AddMarketItemSchema, MarketIdParamSchema, ToggleBoughtSchema } from './market.schema.js';

const router = Router();
const ALLOWED = [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] as const;

// ROUTE ORDER: /market/bought is a literal and must precede /market/:marketId.
router.delete('/market/bought', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), asyncHandler(marketController.clearBought));

router.get('/market', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(marketController.list));
router.post('/market', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), validate(AddMarketItemSchema), asyncHandler(marketController.add));

router.patch('/market/:marketId/bought', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), validate(MarketIdParamSchema, 'params'), validate(ToggleBoughtSchema), asyncHandler(marketController.setBought));
router.delete('/market/:marketId', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), validate(MarketIdParamSchema, 'params'), asyncHandler(marketController.remove));

export function register(app: Express): void {
  app.use('/api/v1', router);
}
