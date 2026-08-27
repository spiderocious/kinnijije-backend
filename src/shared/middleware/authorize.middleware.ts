import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '@lib/errors.js';
import { ERROR_CODES, type ErrorCode } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { roleAtLeast, USER_STATUSES, type UserRole, type UserStatus } from '@shared/constants/roles.js';
import { MESSAGE_KEYS, type MessageKey } from '@shared/messages/keys.js';

import { requireActor } from './authenticate.middleware.js';

/**
 * Role gate. `requireRole(USER_ROLES.ADMIN)` means "admin or above" — the rank
 * comparison means adding a role above admin does not require revisiting every
 * route that named it.
 */
export const requireRole =
  (minimum: UserRole): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const actor = requireActor(req);

    if (!roleAtLeast(actor.role, minimum)) {
      next(
        new AppError(
          ERROR_CODES.INSUFFICIENT_ROLE,
          HTTP_STATUS.FORBIDDEN,
          `role ${actor.role} is below required ${minimum}`,
          MESSAGE_KEYS.access.INSUFFICIENT_ROLE,
          undefined,
          // Diagnostic only: says which gate rejected, so an operator does not
          // have to guess which of several 403s on a route fired.
          `role_below_${minimum}`,
        ),
      );
      return;
    }

    next();
  };

/** Exactly these roles, for a route that is not a simple "or above". */
export const requireOneOfRoles =
  (...allowed: readonly UserRole[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const actor = requireActor(req);

    if (!allowed.includes(actor.role)) {
      next(
        new AppError(
          ERROR_CODES.INSUFFICIENT_ROLE,
          HTTP_STATUS.FORBIDDEN,
          `role ${actor.role} not in [${allowed.join(', ')}]`,
          MESSAGE_KEYS.access.INSUFFICIENT_ROLE,
          undefined,
          'role_not_permitted',
        ),
      );
      return;
    }

    next();
  };

const STATUS_REJECTION: Record<UserStatus, { code: ErrorCode; key: MessageKey } | null> = {
  [USER_STATUSES.ACTIVE]: null,
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
