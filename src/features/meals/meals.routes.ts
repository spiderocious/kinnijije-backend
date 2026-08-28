import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { mealsController } from './meals.controller.js';
import { GenerateMealSchema } from './meals.schema.js';

const router = Router();
const ALLOWED = [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] as const;

/**
 * ROUTE ORDER IS LOAD-BEARING: /meals/suggest and /meals/favourites are
 * literals and MUST precede /meals/:mealId, or "suggest" arrives as a meal id
 * and returns 404 on the most-used endpoint here.
 */
// A LITERAL, so it must sit above /meals/:mealId — otherwise "generate"
// arrives as a meal id and 404s. Costs a model call, hence the AI policy.
router.post(
  '/meals/generate',
  authenticate,
  requireStatus(...ALLOWED),
  rateLimit(RATE_LIMITS.AI_CALL),
  validate(GenerateMealSchema),
  asyncHandler(mealsController.generate),
);

router.get('/meals/suggest', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(mealsController.suggest));
router.get('/meals/favourites', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(mealsController.favourites));
router.get('/meals', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(mealsController.list));

router.get('/meals/:mealId', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(mealsController.detail));
router.post('/meals/:mealId/favourite', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), asyncHandler(mealsController.favourite));
router.delete('/meals/:mealId/favourite', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), asyncHandler(mealsController.unfavourite));
// Cooking is the write that moves stock, so it needs a fully active account.
// Cooking is the product's whole point, and an unverified account can already
// favourite, read recipes and add stock. Gating THIS one action on verification
// blocked the loop at its last step for no reason the person could see.
router.post('/meals/:mealId/cooked', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), asyncHandler(mealsController.cooked));

export function register(app: Express): void {
  app.use('/api/v1', router);
}
