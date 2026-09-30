import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_ROLES, USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireRole, requireStatus, requireScope } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { adminController } from './admin.controller.js';
import { auditRead } from '@lib/audit/index.js';
import { scriptsController } from './scripts/scripts.controller.js';
import { RunScriptSchema } from './scripts/scripts.schema.js';
import { staffController } from './staff/staff.controller.js';
import {
  AcceptInviteSchema,
  InviteStaffSchema,
  ListAuditSchema,
  SetPermissionsSchema,
} from './staff/staff.schema.js';
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
  DeleteRecipesSchema,
  SetRecipesStatusSchema,
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

/**
 * Accepting an invitation. PUBLIC, of necessity: the person has no password
 * yet, so there is nothing to authenticate with.
 *
 * Rate-limited with REGISTER rather than ADMIN — it is an unauthenticated
 * endpoint that creates a credential, which is the same threat shape as
 * signing up.
 */
router.get(
  '/admin/invites/:token',
  rateLimit(RATE_LIMITS.REGISTER),
  asyncHandler(staffController.peekInvite),
);
router.post(
  '/admin/invites/:token/accept',
  rateLimit(RATE_LIMITS.REGISTER),
  validate(AcceptInviteSchema),
  asyncHandler(staffController.acceptInvite),
);

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
// Literal, and registered before '/admin/ai/:logId' so "stats" is not read
// as a log id.
router.get('/admin/ai/stats', ...guard, requireScope('ai:read'), asyncHandler(adminController.aiStats));

router.get('/admin/decide/overview', ...guard, requireScope('decide:read'), asyncHandler(adminController.decideOverview));
router.get('/admin/decide/logs', ...guard, requireScope('decide:read'), asyncHandler(adminController.decideLogs));
// Parameterised LAST: '/decide/logs' and '/decide/overview' are literals and
// must not arrive here as a log id.
router.get('/admin/decide/logs/:logId', ...guard, requireScope('decide:read'), asyncHandler(adminController.decideLog));

router.get('/admin/ranking', ...guard, requireScope('settings:read'), asyncHandler(adminController.rankingConfig));
router.put('/admin/ranking', ...guard, requireScope('settings:write'), asyncHandler(adminController.saveRankingConfig));

// Recipes
router.get('/admin/recipes', ...guard, requireScope('recipes:read'), validate(ListRecipesSchema, 'query'), asyncHandler(adminController.listRecipes));
router.post('/admin/recipes/bulk', ...guard, requireScope('recipes:write'), validate(BulkRecipesSchema), asyncHandler(adminController.bulkRecipes));
// The multi-select delete. A literal, so it must stay above '/:mealId'. Same
// scope as deleting one — a batch is not a lesser power.
router.post('/admin/recipes/delete', ...guard, requireScope('recipes:delete'), validate(DeleteRecipesSchema), asyncHandler(adminController.deleteRecipes));
// Publish or unpublish the selection. Same scope as changing one.
router.post('/admin/recipes/status', ...guard, requireScope('recipes:write'), validate(SetRecipesStatusSchema), asyncHandler(adminController.setRecipesStatus));
router.post('/admin/recipes', ...guard, requireScope('recipes:write'), validate(CreateRecipeSchema), asyncHandler(adminController.createRecipe));
router.get('/admin/recipes/:mealId', ...guard, requireScope('recipes:read'), asyncHandler(adminController.recipeDetail));
router.patch(
  '/admin/recipes/:mealId/status', ...guard, requireScope('recipes:write'),
  validate(SetRecipeStatusSchema),
  asyncHandler(adminController.setRecipeStatus),
);
router.delete('/admin/recipes/:mealId', ...guard, requireScope('recipes:delete'), asyncHandler(adminController.deleteRecipe));

/**
 * Recipe imagery.
 *
 * ROUTE ORDER IS LOAD-BEARING, as everywhere else here: every literal segment
 * (`/prompt`, `/generate`, `/primary`, `/upload-url`) is registered before
 * `/:imageId`, or "generate" arrives as an image id and 404s on the most-used
 * endpoint in the group.
 */
router.get('/admin/recipes/:mealId/images', ...guard, requireScope('images:read'), asyncHandler(adminImagesController.list));

// Costs nothing and needs no key: the "take it to Gemini yourself" path.
router.get('/admin/recipes/:mealId/images/prompt', ...guard, requireScope('images:read'), asyncHandler(adminImagesController.prompt));

router.post(
  '/admin/recipes/:mealId/images/upload-url', ...guard, requireScope('images:write'),
  validate(RequestImageUploadSchema),
  asyncHandler(adminImagesController.requestUpload),
);

// Spends money at OpenAI, so it carries its own policy rather than the
// blanket ADMIN one — a stuck console retry loop must not become a bill.
router.post(
  '/admin/recipes/:mealId/images/generate',
  // NOT `...guard`: this route swaps in a tighter rate limit because an image
  // call costs an order of magnitude more than a text one. The middleware is
  // therefore re-listed by hand — and `requireScope` must come AFTER
  // `authenticate`, since it reads the actor that authenticate sets.
  authenticate,
  requireStatus(USER_STATUSES.ACTIVE),
  requireRole(USER_ROLES.ADMIN),
  rateLimit(RATE_LIMITS.IMAGE_GENERATE),
  requireScope('images:write'),
  validate(GenerateImageSchema),
  asyncHandler(adminImagesController.generate),
);

router.put(
  '/admin/recipes/:mealId/images/primary', ...guard, requireScope('images:write'),
  validate(SetPrimaryImageSchema),
  asyncHandler(adminImagesController.setPrimary),
);

router.post(
  '/admin/recipes/:mealId/images/:imageId/confirm', ...guard, requireScope('images:write'),
  validate(ConfirmImageUploadSchema),
  asyncHandler(adminImagesController.confirmUpload),
);
router.post(
  '/admin/recipes/:mealId/images/:imageId/publish', ...guard, requireScope('images:write'),
  asyncHandler(adminImagesController.publish),
);
router.post(
  '/admin/recipes/:mealId/images/:imageId/reject', ...guard, requireScope('images:write'),
  validate(RejectImageSchema),
  asyncHandler(adminImagesController.reject),
);
router.delete(
  '/admin/recipes/:mealId/images/:imageId', ...guard, requireScope('images:delete'),
  asyncHandler(adminImagesController.remove),
);

// Users
router.get('/admin/users', ...guard, requireScope('users:read'), validate(ListUsersSchema, 'query'), asyncHandler(adminController.listUsers));
router.get('/admin/users/:userId', ...guard, requireScope('users:read'), auditRead('users', 'userId'), asyncHandler(adminController.userDetail));
router.patch(
  '/admin/users/:userId/status', ...guard, requireScope('users:write'),
  validate(SetUserStatusSchema),
  asyncHandler(adminController.setUserStatus),
);
router.patch(
  '/admin/users/:userId/role', ...guard, requireScope('users:write'),
  validate(SetUserRoleSchema),
  asyncHandler(adminController.setUserRole),
);

// AI audit — the literal first.
router.get('/admin/ai/prompt-ids', ...guard, requireScope('ai:read'), asyncHandler(adminController.aiPromptIds));
router.get('/admin/ai', ...guard, requireScope('ai:read'), validate(ListAiLogsSchema, 'query'), asyncHandler(adminController.listAiLogs));
router.get('/admin/ai/:logId', ...guard, requireScope('ai:read'), auditRead('ai', 'logId'), asyncHandler(adminController.aiLogDetail));

// Features
router.get('/admin/features', ...guard, requireScope('flags:read'), asyncHandler(adminController.featureFlags));
router.patch(
  '/admin/features/:flag', ...guard, requireScope('flags:write'),
  validate(SetFeatureFlagSchema),
  asyncHandler(adminController.setFeatureFlag),
);

// Email — literals first, then the parameter.
router.get('/admin/emails/kinds', ...guard, requireScope('emails:read'), asyncHandler(adminController.emailKinds));
router.get('/admin/emails/settings', ...guard, requireScope('emails:read'), asyncHandler(adminController.emailSettings));
router.patch(
  '/admin/emails/settings/:kind', ...guard, requireScope('emails:write'),
  validate(SetEmailKindSchema),
  asyncHandler(adminController.setEmailKind),
);
// Which provider sends. Literal paths, so they must stay above '/:emailId'.
router.get('/admin/emails/provider', ...guard, requireScope('emails:read'), asyncHandler(adminController.mailProvider));
router.put(
  '/admin/emails/provider', ...guard, requireScope('emails:write'),
  validate(SetMailProviderSchema),
  asyncHandler(adminController.setMailProvider),
);
router.post(
  '/admin/emails/provider/test', ...guard, requireScope('emails:write'),
  validate(TestMailProviderSchema),
  asyncHandler(adminController.testMailProvider),
);
router.post(
  '/admin/emails/preview', ...guard, requireScope('emails:read'),
  validate(PreviewAudienceSchema),
  asyncHandler(adminController.previewAudience),
);
router.post(
  '/admin/emails/send', ...guard, requireScope('emails:write'),
  validate(ComposeEmailSchema),
  asyncHandler(adminController.sendEmail),
);
router.get('/admin/emails', ...guard, requireScope('emails:read'), validate(ListEmailsSchema, 'query'), asyncHandler(adminController.listEmails));
router.post('/admin/emails/:emailId/resend', ...guard, requireScope('emails:write'), asyncHandler(adminController.resendEmail));
router.get('/admin/emails/:emailId', ...guard, requireScope('emails:read'), auditRead('emails', 'emailId'), asyncHandler(adminController.emailDetail));

// Jobs — the literal first, then the sub-paths, then the bare parameter.
router.get('/admin/jobs/types', ...guard, requireScope('jobs:read'), asyncHandler(adminController.jobTypes));
router.get('/admin/jobs', ...guard, requireScope('jobs:read'), validate(ListJobsSchema, 'query'), asyncHandler(adminController.listJobs));
router.post(
  '/admin/jobs/:jobId/retry', ...guard, requireScope('jobs:write'),
  validate(RetryJobSchema),
  asyncHandler(adminController.retryJob),
);
router.post('/admin/jobs/:jobId/cancel', ...guard, requireScope('jobs:write'), asyncHandler(adminController.cancelJob));
router.get('/admin/jobs/:jobId', ...guard, requireScope('jobs:read'), asyncHandler(adminController.jobDetail));

// ── Staff, permissions and the trail ─────────────────────────────────
router.get('/admin/staff/groups', ...guard, requireScope('staff:read'), staffController.groups);
router.get('/admin/staff', ...guard, requireScope('staff:read'), asyncHandler(staffController.list));
router.post(
  '/admin/staff/invites',
  ...guard,
  requireScope('staff:write'),
  validate(InviteStaffSchema),
  asyncHandler(staffController.invite),
);
router.delete(
  '/admin/staff/:userId/invite',
  ...guard,
  requireScope('staff:write'),
  asyncHandler(staffController.revokeInvite),
);
router.patch(
  '/admin/staff/:userId/permissions',
  ...guard,
  requireScope('staff:write'),
  validate(SetPermissionsSchema),
  asyncHandler(staffController.setPermissions),
);

/**
 * Operator scripts: the replacement for `pnpm <migration>` on a box with no
 * shell.
 *
 * Its own resource, split read from write: seeing WHICH operations exist and
 * what they last returned is useful to anybody debugging, while running one
 * rewrites data globally and stays super-admin-only.
 */
router.get('/admin/scripts', ...guard, requireScope('scripts:read'), asyncHandler(scriptsController.list));
router.post(
  '/admin/scripts/:scriptId/run',
  ...guard,
  requireScope('scripts:write'),
  validate(RunScriptSchema),
  asyncHandler(scriptsController.run),
);

// Reading the trail is itself auditable — see the auditRead on this route.
router.get(
  '/admin/audit',
  ...guard,
  requireScope('audit:read'),
  // Reading the trail is an act worth recording.
  auditRead('audit', 'none'),
  validate(ListAuditSchema, 'query'),
  asyncHandler(staffController.auditLog),
);

export function register(app: Express): void {
  app.use('/api/v1', router);
}
