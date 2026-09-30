import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_ROLES, USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireRole, requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { adminController } from './admin.controller.js';
import { adminImagesController } from './images/admin-images.controller.js';
import {
  ConfirmImageUploadSchema,
  GenerateImageSchema,
  RejectImageSchema,
  RequestImageUploadSchema,
  SetPrimaryImageSchema,
} from './images/admin-images.schema.js';
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
  SetEmailKindSchema,
  SetFeatureFlagSchema,
  SetMailProviderSchema,
  SetRecipeStatusSchema,
  SetUserRoleSchema,
  SetUserStatusSchema,
  TestMailProviderSchema,
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

// How meals are ranked. Tunable, because ranking quality is an empirical
// question and a constant buried in a function cannot be answered empirically.
// Visibility into the anonymous decide flow: what people submit, what we
// answer, and how often the model actually contributes.
router.get('/admin/decide/overview', ...guard, asyncHandler(adminController.decideOverview));
router.get('/admin/decide/logs', ...guard, asyncHandler(adminController.decideLogs));
// Parameterised LAST: '/decide/logs' and '/decide/overview' are literals and
// must not arrive here as a log id.
router.get('/admin/decide/logs/:logId', ...guard, asyncHandler(adminController.decideLog));

router.get('/admin/ranking', ...guard, asyncHandler(adminController.rankingConfig));
router.put('/admin/ranking', ...guard, asyncHandler(adminController.saveRankingConfig));

// Recipes
router.get('/admin/recipes', ...guard, validate(ListRecipesSchema, 'query'), asyncHandler(adminController.listRecipes));
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

/**
 * Recipe imagery.
 *
 * ROUTE ORDER IS LOAD-BEARING, as everywhere else here: every literal segment
 * (`/prompt`, `/generate`, `/primary`, `/upload-url`) is registered before
 * `/:imageId`, or "generate" arrives as an image id and 404s on the most-used
 * endpoint in the group.
 */
router.get('/admin/recipes/:mealId/images', ...guard, asyncHandler(adminImagesController.list));

// Costs nothing and needs no key: the "take it to Gemini yourself" path.
router.get('/admin/recipes/:mealId/images/prompt', ...guard, asyncHandler(adminImagesController.prompt));

router.post(
  '/admin/recipes/:mealId/images/upload-url',
  ...guard,
  validate(RequestImageUploadSchema),
  asyncHandler(adminImagesController.requestUpload),
);

// Spends money at OpenAI, so it carries its own policy rather than the
// blanket ADMIN one — a stuck console retry loop must not become a bill.
router.post(
  '/admin/recipes/:mealId/images/generate',
  authenticate,
  requireStatus(USER_STATUSES.ACTIVE),
  requireRole(USER_ROLES.ADMIN),
  rateLimit(RATE_LIMITS.IMAGE_GENERATE),
  validate(GenerateImageSchema),
  asyncHandler(adminImagesController.generate),
);

router.put(
  '/admin/recipes/:mealId/images/primary',
  ...guard,
  validate(SetPrimaryImageSchema),
  asyncHandler(adminImagesController.setPrimary),
);

router.post(
  '/admin/recipes/:mealId/images/:imageId/confirm',
  ...guard,
  validate(ConfirmImageUploadSchema),
  asyncHandler(adminImagesController.confirmUpload),
);
router.post(
  '/admin/recipes/:mealId/images/:imageId/publish',
  ...guard,
  asyncHandler(adminImagesController.publish),
);
router.post(
  '/admin/recipes/:mealId/images/:imageId/reject',
  ...guard,
  validate(RejectImageSchema),
  asyncHandler(adminImagesController.reject),
);
router.delete(
  '/admin/recipes/:mealId/images/:imageId',
  ...guard,
  asyncHandler(adminImagesController.remove),
);

// Users
router.get('/admin/users', ...guard, validate(ListUsersSchema, 'query'), asyncHandler(adminController.listUsers));
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
router.get('/admin/ai', ...guard, validate(ListAiLogsSchema, 'query'), asyncHandler(adminController.listAiLogs));
router.get('/admin/ai/:logId', ...guard, asyncHandler(adminController.aiLogDetail));

// Features
router.get('/admin/features', ...guard, asyncHandler(adminController.featureFlags));
router.patch(
  '/admin/features/:flag',
  ...guard,
  validate(SetFeatureFlagSchema),
  asyncHandler(adminController.setFeatureFlag),
);

// Email — literals first, then the parameter.
router.get('/admin/emails/kinds', ...guard, asyncHandler(adminController.emailKinds));
router.get('/admin/emails/settings', ...guard, asyncHandler(adminController.emailSettings));
router.patch(
  '/admin/emails/settings/:kind',
  ...guard,
  validate(SetEmailKindSchema),
  asyncHandler(adminController.setEmailKind),
);
// Which provider sends. Literal paths, so they must stay above '/:emailId'.
router.get('/admin/emails/provider', ...guard, asyncHandler(adminController.mailProvider));
router.put(
  '/admin/emails/provider',
  ...guard,
  validate(SetMailProviderSchema),
  asyncHandler(adminController.setMailProvider),
);
router.post(
  '/admin/emails/provider/test',
  ...guard,
  validate(TestMailProviderSchema),
  asyncHandler(adminController.testMailProvider),
);
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
router.get('/admin/emails', ...guard, validate(ListEmailsSchema, 'query'), asyncHandler(adminController.listEmails));
router.post('/admin/emails/:emailId/resend', ...guard, asyncHandler(adminController.resendEmail));
router.get('/admin/emails/:emailId', ...guard, asyncHandler(adminController.emailDetail));

// Jobs — the literal first, then the sub-paths, then the bare parameter.
router.get('/admin/jobs/types', ...guard, asyncHandler(adminController.jobTypes));
router.get('/admin/jobs', ...guard, validate(ListJobsSchema, 'query'), asyncHandler(adminController.listJobs));
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
