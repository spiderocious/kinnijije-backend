import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireStatus } from '@shared/middleware/authorize.middleware.js';
import { byBodyField, byIp, rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';
import { USER_STATUSES } from '@shared/constants/roles.js';

import { authController } from './auth.controller.js';
import {
  ChangePasswordSchema,
  LoginSchema,
  LogoutSchema,
  RefreshSchema,
  RegisterSchema,
} from './auth.schema.js';

const router = Router();

/**
 * Middleware order on every route below: rate limit → validate → handle.
 *
 * The limiter runs FIRST so a flood is refused before argon2 or a database
 * round-trip is spent on it. Putting validation first would mean an attacker
 * gets free work out of us on every malformed request.
 *
 * Exception, deliberate: login is limited by IP *and* by email, and the email
 * bucket needs a parsed body — so its per-email limiter sits after validation.
 * The IP bucket still runs first, which is what bounds the unparsed flood.
 */

router.post(
  '/auth/register',
  rateLimit(RATE_LIMITS.REGISTER, byIp),
  validate(RegisterSchema),
  asyncHandler(authController.register),
);

router.post(
  '/auth/login',
  rateLimit(RATE_LIMITS.LOGIN, byIp, 'ip'),
  validate(LoginSchema),
  // Per-email bucket: IP rotation alone should not buy unlimited guesses at
  // one account. Runs after validation because it reads the parsed body.
  rateLimit(RATE_LIMITS.LOGIN, byBodyField('email'), 'email'),
  asyncHandler(authController.login),
);

router.post(
  '/auth/refresh',
  rateLimit(RATE_LIMITS.REFRESH, byIp),
  validate(RefreshSchema),
  asyncHandler(authController.refresh),
);

// Logout takes the refresh token in the body rather than requiring a valid
// access token: a client whose access token has expired must still be able to
// end its session.
router.post(
  '/auth/logout',
  rateLimit(RATE_LIMITS.AUTHENTICATED_WRITE, byIp),
  validate(LogoutSchema),
  asyncHandler(authController.logout),
);

router.post(
  '/auth/change-password',
  authenticate,
  // A pending (unverified) account may still change its password — locking a
  // user out of their own credentials before verification helps nobody.
  requireStatus(USER_STATUSES.ACTIVE, USER_STATUSES.PENDING),
  rateLimit(RATE_LIMITS.PASSWORD_RESET),
  validate(ChangePasswordSchema),
  asyncHandler(authController.changePassword),
);

export function register(app: Express): void {
  app.use('/api/v1', router);
}
