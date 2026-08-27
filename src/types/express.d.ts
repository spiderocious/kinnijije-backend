import type { UserRole, UserStatus } from '../shared/constants/roles.js';

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
      actor?: {
        userId: string;
        role: UserRole;
        status: UserStatus;
        sessionId: string;
      };
    }
  }
}

export {};
