import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_ROLES, USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireRole, requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { adminController } from './admin.controller.js';
import {
  BulkRecipesSchema,
  ComposeEmailSchema,
  CreateRecipeSchema,
  ListAiLogsSchema,
  ListEmailsSchema,
  ListJobsSchema,
  ListRecipesSchema,
  ListUsersSchema,
  PreviewAudienceSchema,
  RetryJobSchema,
  SetRecipeStatusSchema,
  SetUserRoleSchema,
  SetUserStatusSchema,
} from './admin.schema.js';

const router = Router();

/**
 * The console.
 *
 * Everything below `/admin` requires an ADMIN or above, an ACTIVE account, and
 * the admin rate limit — with exactly two exceptions, both at the top, both
 * unauthenticated by necessity: you cannot log in to create the first login.
 *
 * ROUTE ORDER IS LOAD-BEARING: every literal (`/admin/ai/prompt-ids`,
 * `/admin/jobs/types`) must precede the parameterised route that would
 * otherwise swallow it.
 */

// ── Setup: unauthenticated, and closed the moment an admin exists ────
router.get('/admin/setup', rateLimit(RATE_LIMITS.REGISTER), asyncHandler(adminController.setupState));
router.post('/admin/setup', rateLimit(RATE_LIMITS.REGISTER), asyncHandler(adminController.bootstrap));

// ── Everything else ──────────────────────────────────────────────────
const guard = [
  authenticate,
  requireStatus(USER_STATUSES.ACTIVE),
  requireRole(USER_ROLES.ADMIN),
  rateLimit(RATE_LIMITS.ADMIN),
];

router.get('/admin/overview', ...guard, asyncHandler(adminController.overview));

// Recipes
router.get('/admin/recipes', ...guard, validate(ListRecipesSchema), asyncHandler(adminController.listRecipes));
router.post('/admin/recipes/bulk', ...guard, validate(BulkRecipesSchema), asyncHandler(adminController.bulkRecipes));
router.post('/admin/recipes', ...guard, validate(CreateRecipeSchema), asyncHandler(adminController.createRecipe));
router.get('/admin/recipes/:mealId', ...guard, asyncHandler(adminController.recipeDetail));
router.patch(
  '/admin/recipes/:mealId/status',
  ...guard,
  validate(SetRecipeStatusSchema),
  asyncHandler(adminController.setRecipeStatus),
);
router.delete('/admin/recipes/:mealId', ...guard, asyncHandler(adminController.deleteRecipe));

// Users
router.get('/admin/users', ...guard, validate(ListUsersSchema), asyncHandler(adminController.listUsers));
router.get('/admin/users/:userId', ...guard, asyncHandler(adminController.userDetail));
router.patch(
  '/admin/users/:userId/status',
  ...guard,
  validate(SetUserStatusSchema),
  asyncHandler(adminController.setUserStatus),
);
router.patch(
  '/admin/users/:userId/role',
  ...guard,
  validate(SetUserRoleSchema),
  asyncHandler(adminController.setUserRole),
);

// AI audit — the literal first.
router.get('/admin/ai/prompt-ids', ...guard, asyncHandler(adminController.aiPromptIds));
router.get('/admin/ai', ...guard, validate(ListAiLogsSchema), asyncHandler(adminController.listAiLogs));
router.get('/admin/ai/:logId', ...guard, asyncHandler(adminController.aiLogDetail));

// Email — literals first, then the parameter.
router.get('/admin/emails/kinds', ...guard, asyncHandler(adminController.emailKinds));
router.post(
  '/admin/emails/preview',
  ...guard,
  validate(PreviewAudienceSchema),
  asyncHandler(adminController.previewAudience),
);
router.post(
  '/admin/emails/send',
  ...guard,
  validate(ComposeEmailSchema),
  asyncHandler(adminController.sendEmail),
);
router.get('/admin/emails', ...guard, validate(ListEmailsSchema), asyncHandler(adminController.listEmails));
router.post('/admin/emails/:emailId/resend', ...guard, asyncHandler(adminController.resendEmail));
router.get('/admin/emails/:emailId', ...guard, asyncHandler(adminController.emailDetail));

// Jobs — the literal first, then the sub-paths, then the bare parameter.
router.get('/admin/jobs/types', ...guard, asyncHandler(adminController.jobTypes));
router.get('/admin/jobs', ...guard, validate(ListJobsSchema), asyncHandler(adminController.listJobs));
router.post(
  '/admin/jobs/:jobId/retry',
  ...guard,
  validate(RetryJobSchema),
  asyncHandler(adminController.retryJob),
);
router.post('/admin/jobs/:jobId/cancel', ...guard, asyncHandler(adminController.cancelJob));
router.get('/admin/jobs/:jobId', ...guard, asyncHandler(adminController.jobDetail));

export function register(app: Express): void {
  app.use('/api/v1', router);
}
