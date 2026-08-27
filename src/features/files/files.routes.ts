import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { filesController } from './files.controller.js';
import { FileIdParamSchema, ListFilesQuerySchema, RequestUploadSchema } from './files.schema.js';

const router = Router();

/**
 * ROUTE ORDER IS LOAD-BEARING: `/files` (the listing) is registered before
 * `/files/:fileId`, and `/files/:fileId/confirm` before the bare param route,
 * so a literal segment is never swallowed by the parameterised one.
 */

router.get(
  '/files',
  authenticate,
  requireStatus(USER_STATUSES.ACTIVE, USER_STATUSES.PENDING),
  rateLimit(RATE_LIMITS.AUTHENTICATED_READ),
  validate(ListFilesQuerySchema, 'query'),
  asyncHandler(filesController.list),
);

router.post(
  '/files/upload-url',
  authenticate,
  // A pending (unverified) account may upload: onboarding happens before
  // verification, and photographing a shelf is part of it.
  requireStatus(USER_STATUSES.ACTIVE, USER_STATUSES.PENDING),
  rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE),
  validate(RequestUploadSchema),
  asyncHandler(filesController.requestUpload),
);

router.post(
  '/files/:fileId/confirm',
  authenticate,
  requireStatus(USER_STATUSES.ACTIVE, USER_STATUSES.PENDING),
  rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE),
  validate(FileIdParamSchema, 'params'),
  asyncHandler(filesController.confirmUpload),
);

router.get(
  '/files/:fileId',
  authenticate,
  requireStatus(USER_STATUSES.ACTIVE, USER_STATUSES.PENDING),
  rateLimit(RATE_LIMITS.AUTHENTICATED_READ),
  validate(FileIdParamSchema, 'params'),
  asyncHandler(filesController.getOne),
);

export function register(app: Express): void {
  app.use('/api/v1', router);
}
