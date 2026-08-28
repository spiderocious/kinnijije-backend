import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { chatController } from './chat.controller.js';
import { AskSchema } from './chat.schema.js';

const router = Router();
const ALLOWED = [USER_STATUSES.ACTIVE, USER_STATUSES.PENDING] as const;

router.get('/chat', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_READ), asyncHandler(chatController.history));
// Every question costs a model call — and the round-trip can cost TWO, since
// a reply carrying tool calls goes back to the model a second time.
router.post('/chat', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AI_CALL), validate(AskSchema), asyncHandler(chatController.ask));
router.delete('/chat', authenticate, requireStatus(...ALLOWED), rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE), asyncHandler(chatController.clear));

export function register(app: Express): void {
  app.use('/api/v1', router);
}
