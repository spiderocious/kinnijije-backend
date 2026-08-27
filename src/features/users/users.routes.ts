import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_ROLES, USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireRole, requireStatus } from '@shared/middleware/authorize.middleware.js';
import { rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { usersController } from './users.controller.js';
import {
  ListUsersQuerySchema,
  UpdateProfileSchema,
  UpdateRoleSchema,
  UpdateStatusSchema,
  UserIdParamSchema,
} from './users.schema.js';

const router = Router();

/**
 * `authenticate` is attached per-route below rather than via `router.use()`.
 *
 * A router-level `use()` runs for EVERY path under the mount prefix, matched
 * or not — so an unknown /api/v1/* path was answering 401 instead of falling
 * through to the 404 handler, telling an anonymous caller "sign in" about a
 * route that does not exist. Per-route is more typing and strictly correct.
 */

/**
 * ROUTE ORDER IS LOAD-BEARING BELOW.
 *
 * `/users/me` MUST be registered before `/users/:userId`, or Express matches
 * the parameterised route first and "me" arrives as a literal user id — a 404
 * on the most-used endpoint in the app. Do not alphabetise these.
 */

router.get(
  '/users/me',
  authenticate,
  // A pending account can read its own profile: it needs somewhere to land
  // after signup, before verification.
  requireStatus(USER_STATUSES.ACTIVE, USER_STATUSES.PENDING, USER_STATUSES.SUSPENDED),
  rateLimit(RATE_LIMITS.AUTHENTICATED_READ),
  asyncHandler(usersController.me),
);

router.patch(
  '/users/me',
  authenticate,
  // Writing is gated harder than reading — this is the status gate doing the
  // work a role check cannot: a suspended user keeps their role and still
  // cannot change anything.
  requireStatus(USER_STATUSES.ACTIVE),
  rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE),
  validate(UpdateProfileSchema),
  asyncHandler(usersController.updateMe),
);

// --- Admin surface. Registered after /users/me for the reason stated above. ---

router.get(
  '/users',
  authenticate,
  requireRole(USER_ROLES.ADMIN),
  requireStatus(USER_STATUSES.ACTIVE),
  rateLimit(RATE_LIMITS.ADMIN),
  validate(ListUsersQuerySchema, 'query'),
  asyncHandler(usersController.list),
);

router.get(
  '/users/:userId',
  authenticate,
  requireRole(USER_ROLES.ADMIN),
  requireStatus(USER_STATUSES.ACTIVE),
  rateLimit(RATE_LIMITS.ADMIN),
  validate(UserIdParamSchema, 'params'),
  asyncHandler(usersController.getOne),
);

router.patch(
  '/users/:userId/status',
  authenticate,
  // Moderators can suspend; they cannot change roles (below).
  requireRole(USER_ROLES.MODERATOR),
  requireStatus(USER_STATUSES.ACTIVE),
  rateLimit(RATE_LIMITS.ADMIN),
  validate(UserIdParamSchema, 'params'),
  validate(UpdateStatusSchema),
  asyncHandler(usersController.updateStatus),
);

router.patch(
  '/users/:userId/role',
  authenticate,
  // Granting privilege is strictly super-admin: an admin who can mint admins
  // is an admin who can escalate anyone, including a compromised account.
  requireRole(USER_ROLES.SUPER_ADMIN),
  requireStatus(USER_STATUSES.ACTIVE),
  rateLimit(RATE_LIMITS.ADMIN),
  validate(UserIdParamSchema, 'params'),
  validate(UpdateRoleSchema),
  asyncHandler(usersController.updateRole),
);

export function register(app: Express): void {
  app.use('/api/v1', router);
}
