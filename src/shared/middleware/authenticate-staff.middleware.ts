import type { NextFunction, Request, Response } from 'express';

import { StaffUserModel, STAFF_SESSION_ALLOWED } from '@features/admin/staff/staff-user.model.js';
import { verifyStaffToken } from '@features/admin/auth/staff-tokens.js';
import { AppError } from '@lib/errors.js';
import { requestContext } from '@lib/http/request-context.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

/**
 * Authenticates a console request.
 *
 * Separate from `authenticate` on purpose. A customer token is signed for the
 * `cookiepot-web` audience and this verifies against `cookiepot-console`, so a
 * customer token does not fail a role check here — it fails signature
 * verification and can never reach an admin route at all.
 *
 * The status is re-read from the row rather than trusted from the claim. The
 * claim is 15 minutes stale at worst, and "suspended five minutes ago but
 * still deleting recipes" is precisely the case this surface must not allow.
 * It is one indexed lookup on a handful of requests from a handful of people.
 */
export async function authenticateStaff(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header('authorization');

  if (header === undefined || !header.startsWith('Bearer ')) {
    next(
      new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HTTP_STATUS.UNAUTHORIZED,
        'no console bearer token',
        MESSAGE_KEYS.auth.UNAUTHENTICATED,
        undefined,
        'missing_staff_token',
      ),
    );
    return;
  }

  const result = verifyStaffToken(header.slice('Bearer '.length).trim());

  if (!result.valid) {
    next(
      new AppError(
        result.reason === 'expired' ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID,
        HTTP_STATUS.UNAUTHORIZED,
        `console token ${result.reason}`,
        result.reason === 'expired' ? MESSAGE_KEYS.auth.TOKEN_EXPIRED : MESSAGE_KEYS.auth.TOKEN_INVALID,
        undefined,
        // A customer token presented here lands on `invalid`, because the
        // audience does not match. That is the intended outcome.
        `staff_token_${result.reason}`,
      ),
    );
    return;
  }

  const staff = await StaffUserModel.findById(result.claims.sub, {
    email: 1,
    tier: 1,
    status: 1,
  })
    .lean()
    .exec();

  if (staff === null || !STAFF_SESSION_ALLOWED.includes(staff.status)) {
    next(
      new AppError(
        ERROR_CODES.SESSION_REVOKED,
        HTTP_STATUS.UNAUTHORIZED,
        'console account is no longer active',
        MESSAGE_KEYS.auth.SESSION_REVOKED,
        undefined,
        'staff_not_active',
      ),
    );
    return;
  }

  req.staff = {
    staffId: staff._id,
    email: staff.email,
    tier: staff.tier,
    status: staff.status,
    sessionId: result.claims.sid,
  };

  // Logs and the audit trail read the actor from here, so a console action is
  // attributed without any service taking `req`.
  const context = requestContext.getStore();
  if (context !== undefined) {
    context.user_id = staff._id;
    context.session_id = result.claims.sid;
  }

  next();
}

/**
 * The console actor, or a thrown error.
 *
 * Mirrors `requireActor`: anything behind `authenticateStaff` may assume this
 * succeeds, and a route that forgot the middleware fails loudly rather than
 * silently treating the request as anonymous.
 */
export function requireStaff(req: Request): NonNullable<Request['staff']> {
  if (req.staff === undefined) {
    throw new AppError(
      ERROR_CODES.UNAUTHENTICATED,
      HTTP_STATUS.UNAUTHORIZED,
      'requireStaff called on a route without authenticateStaff',
      MESSAGE_KEYS.auth.UNAUTHENTICATED,
    );
  }
  return req.staff;
}
