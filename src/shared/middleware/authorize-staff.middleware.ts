import type { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  STAFF_TIERS,
  StaffUserModel,
  tierAtLeast,
  type StaffTier,
} from '@features/admin/staff/staff-user.model.js';
import { AppError } from '@lib/errors.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { satisfies, type Scope } from '@shared/constants/permissions.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import { requireStaff } from './authenticate-staff.middleware.js';

/**
 * Tier gate — the coarse half of console authorisation.
 *
 * `requireTier(ADMIN)` means "admin or above", so adding a tier above admin
 * does not mean revisiting every route that named it.
 *
 * Most routes should NOT use this. The scope is the real gate; a tier is for
 * the handful of things where seniority itself is the requirement, like
 * managing other staff.
 */
export const requireTier =
  (minimum: StaffTier): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const staff = requireStaff(req);

    if (!tierAtLeast(staff.tier, minimum)) {
      next(
        new AppError(
          ERROR_CODES.INSUFFICIENT_ROLE,
          HTTP_STATUS.FORBIDDEN,
          `tier ${staff.tier} is below required ${minimum}`,
          MESSAGE_KEYS.access.INSUFFICIENT_ROLE,
          undefined,
          `tier_below_${minimum}`,
        ),
      );
      return;
    }

    next();
  };

/**
 * Scope gate. The per-action half, and the one that does the real work.
 *
 * Reads permissions from `staff_users` rather than the token, deliberately:
 * the tier and status ride in the claims because 15 minutes of staleness is
 * tolerable for those, but a revoked SCOPE that keeps working for 15 minutes
 * is a person still deleting things after you stopped them.
 *
 * `super_admin` bypasses rather than holding every scope, which keeps "who can
 * lock everybody out" answerable by reading one field, and means a scope added
 * later cannot leave the owner unable to reach it.
 */
export const requireScope =
  (needed: Scope): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const staff = requireStaff(req);

    if (staff.tier === STAFF_TIERS.SUPER_ADMIN) {
      next();
      return;
    }

    void (async () => {
      try {
        const row = await StaffUserModel.findById(staff.staffId, { permissions: 1 })
          .lean()
          .exec();
        const held: readonly string[] = row?.permissions ?? [];

        if (satisfies(held, needed)) {
          next();
          return;
        }

        // Recorded before the refusal: somebody repeatedly probing what they
        // cannot reach is the most interesting signal the trail carries.
        const { auditDenial } = await import('@lib/audit/index.js');
        auditDenial(req, needed);

        next(
          new AppError(
            ERROR_CODES.FORBIDDEN,
            HTTP_STATUS.FORBIDDEN,
            `console actor lacks scope ${needed}`,
            MESSAGE_KEYS.access.FORBIDDEN,
            undefined,
            // Names the missing scope, so a support ticket does not require
            // guessing which of several gates fired.
            `missing_scope_${needed}`,
          ),
        );
      } catch (error) {
        next(error);
      }
    })();
  };
