import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { stockController } from './stock.controller.js';
import {
  AddStockSchema,
  CreateCustomUnitSchema,
  StockIdParamSchema,
  SuggestQuerySchema,
  UpdateStockSchema,
} from './stock.schema.js';

const router = Router();
const ALLOWED = [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] as const;

/**
 * ROUTE ORDER IS LOAD-BEARING throughout: every literal path — /dashboard,
 * /suggest, /history, /units — is registered BEFORE /stock/:stockId, or the
 * parameter route swallows them and "dashboard" arrives as a stock id.
 */

router.get('/stock/dashboard', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(stockController.dashboard));
router.get('/stock/suggest', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), validate(SuggestQuerySchema, 'query'), stockController.suggest);
router.get('/stock/history', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(stockController.history));

router.get('/stock/units', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(stockController.listUnits));
router.post('/stock/units', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), validate(CreateCustomUnitSchema), asyncHandler(stockController.createUnit));
router.delete('/stock/units/:unitId', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), asyncHandler(stockController.deleteUnit));

router.get('/stock', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(stockController.list));
router.post('/stock', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), validate(AddStockSchema), asyncHandler(stockController.add));

// Parameterised last.
router.get('/stock/:stockId', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), validate(StockIdParamSchema, 'params'), asyncHandler(stockController.getOne));
router.patch('/stock/:stockId', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), validate(StockIdParamSchema, 'params'), validate(UpdateStockSchema), asyncHandler(stockController.update));
router.delete('/stock/:stockId', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), validate(StockIdParamSchema, 'params'), asyncHandler(stockController.remove));

export function register(app: Express): void {
  app.use('/api/v1', router);
}
