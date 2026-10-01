import type { UserStatus } from '../shared/constants/roles.js';
import type { StaffStatus, StaffTier } from '../features/admin/staff/staff-user.model.js';

/**
 * Adds the authenticated actor to Express's Request.
 *
 * It lives in its own ambient declaration file rather than beside the
 * middleware because the augmentation must be able to resolve
 * 'express-serve-static-core' as a module in scope — inside a file that only
 * imports 'express', it silently fails to apply.
 */
declare global {
  namespace Express {
    interface Request {
      /**
       * The CUSTOMER actor. Carries no role: staff are a separate identity
       * domain with their own token audience and their own request field.
       */
      actor?: {
        userId: string;
        status: UserStatus;
        sessionId: string;
      };
      /**
       * The console actor. Set only by `authenticateStaff`, and NEVER by the
       * customer `authenticate` — the two are separate identity domains, so a
       * request carries one or the other and never both.
       */
      staff?: {
        staffId: string;
        email: string;
        tier: StaffTier;
        status: StaffStatus;
        sessionId: string;
      };
    }
  }
}

export {};
