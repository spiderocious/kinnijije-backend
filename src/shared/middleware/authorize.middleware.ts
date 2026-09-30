import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '@lib/errors.js';
import { ERROR_CODES, type ErrorCode } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { satisfies, type Scope } from '@shared/constants/permissions.js';
import {
  roleAtLeast,
  USER_ROLES,
  USER_STATUSES,
  type UserRole,
  type UserStatus,
} from '@shared/constants/roles.js';
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

/**
 * Scope gate. The per-action half of authorisation.
 *
 * `requireRole(ADMIN)` is the door — it says somebody belongs in the console at
 * all. This is the room: it says whether they may do THIS.
 *
 * TWO DELIBERATE CHOICES:
 *
 * 1. **Read from the database, not the token.** The access token carries role
 *    and status as claims so an ordinary request needs no lookup, and 15
 *    minutes of stale role is tolerable because a ban also revokes sessions.
 *    A revoked SCOPE that keeps working for 15 minutes is different: it is a
 *    person still deleting recipes after you stopped them. Admin routes are a
 *    handful of requests from a handful of people, so one indexed findById is
 *    the right trade.
 *
 * 2. **Super admin bypasses rather than holding every scope.** That keeps "who
 *    can lock everybody out" answerable by reading one field, and means a
 *    scope added later cannot leave the owner unable to reach it.
 */
export const requireScope =
  (needed: Scope): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const actor = requireActor(req);

    if (actor.role === USER_ROLES.SUPER_ADMIN) {
      next();
      return;
    }

    void (async () => {
      try {
        const { UserModel } = await import('@features/users/users.model.js');
        const row = await UserModel.findById(actor.userId, { permissions: 1 }).lean().exec();
        const held: readonly string[] = row?.permissions ?? [];

        if (satisfies(held, needed)) {
          next();
          return;
        }

        const { auditDenial } = await import('@lib/audit/index.js');
        auditDenial(req, needed);

        next(
          new AppError(
            ERROR_CODES.FORBIDDEN,
            HTTP_STATUS.FORBIDDEN,
            `actor lacks scope ${needed}`,
            MESSAGE_KEYS.access.FORBIDDEN,
            undefined,
            // Diagnostic only. Says WHICH scope was missing, so an operator
            // reading a support ticket does not have to guess.
            `missing_scope_${needed}`,
          ),
        );
      } catch (error) {
        next(error);
      }
    })();
  };
