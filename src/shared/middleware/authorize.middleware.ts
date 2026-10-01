import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '@lib/errors.js';
import { ERROR_CODES, type ErrorCode } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { USER_STATUSES, type UserStatus } from '@shared/constants/roles.js';
import { MESSAGE_KEYS, type MessageKey } from '@shared/messages/keys.js';

import { requireActor } from './authenticate.middleware.js';

/**
 * NO ROLE GATE HERE ANY MORE.
 *
 * `requireRole` and `requireOneOfRoles` gated a customer token on a `role`
 * field that no longer exists — staff are a separate identity domain now, with
 * `requireTier` and `requireScope` in `authorize-staff.middleware.ts`.
 *
 * What remains is the STATUS gate, which is about a customer account's
 * lifecycle and has nothing to do with the console.
 */

const STATUS_REJECTION: Record<UserStatus, { code: ErrorCode; key: MessageKey } | null> = {
  [USER_STATUSES.ACTIVE]: null,
  /**
   * An invited staff member has no password yet, so they cannot hold a session
   * and should never reach a status gate. Mapped anyway — the exhaustive
   * Record is what guarantees a new status cannot be added without somebody
   * deciding what it means here.
   */
  [USER_STATUSES.INVITED]: {
    code: ERROR_CODES.ACCOUNT_PENDING_VERIFICATION,
    key: MESSAGE_KEYS.access.ACCOUNT_PENDING_VERIFICATION,
  },
  [USER_STATUSES.PENDING]: {
    code: ERROR_CODES.ACCOUNT_PENDING_VERIFICATION,
    key: MESSAGE_KEYS.access.ACCOUNT_PENDING_VERIFICATION,
  },
  [USER_STATUSES.SUSPENDED]: {
    code: ERROR_CODES.ACCOUNT_SUSPENDED,
    key: MESSAGE_KEYS.access.ACCOUNT_SUSPENDED,
  },
  [USER_STATUSES.BANNED]: {
    code: ERROR_CODES.ACCOUNT_BANNED,
    key: MESSAGE_KEYS.access.ACCOUNT_BANNED,
  },
  [USER_STATUSES.DELETED]: {
    code: ERROR_CODES.ACCOUNT_DELETED,
    key: MESSAGE_KEYS.access.ACCOUNT_DELETED,
  },
};

/**
 * Status gate — the permission axis that is not about role.
 *
 * Status and role are orthogonal on purpose: a suspended admin is still an
 * admin and must still be refused. Checking only the role is how a suspended
 * privileged account keeps acting.
 *
 * The default is ACTIVE only. A route that a pending (unverified) user may
 * still reach — reading their own profile, say — opts in explicitly by listing
 * PENDING, which makes every such exception visible at the route.
 */
export const requireStatus =
  (...allowed: readonly UserStatus[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const actor = requireActor(req);

    if (allowed.includes(actor.status)) {
      next();
      return;
    }

    const rejection = STATUS_REJECTION[actor.status] ?? {
      code: ERROR_CODES.FORBIDDEN,
      key: MESSAGE_KEYS.access.FORBIDDEN,
    };

    next(
      new AppError(
        rejection.code,
        HTTP_STATUS.FORBIDDEN,
        `status ${actor.status} not in [${allowed.join(', ')}]`,
        rejection.key,
        undefined,
        `status_${actor.status}_blocked`,
      ),
    );
  };

/**
 * The common case, named: an action that changes something requires a fully
 * active account. Reads are generally happy with `requireStatus(ACTIVE, PENDING)`.
 */
export const requireActiveAccount = (): RequestHandler => requireStatus(USER_STATUSES.ACTIVE);
