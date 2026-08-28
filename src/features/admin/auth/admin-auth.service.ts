import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

import { UserModel } from '@features/users/users.model.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { USER_ROLES, USER_STATUSES } from '@shared/constants/roles.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

export interface BootstrapResult {
  email: string;
  password: string;
  user_id: string;
}

/**
 * Creating the very first administrator.
 *
 * The password is generated here and shown ONCE, on screen. It is never
 * emailed and never stored in the clear — the only copy is the one the person
 * reads, which is why the endpoint says so plainly.
 */
export class AdminAuthService {
  private static instance: AdminAuthService | undefined;

  static getInstance(): AdminAuthService {
    AdminAuthService.instance ??= new AdminAuthService();
    return AdminAuthService.instance;
  }

  /** Whether the console still needs setting up. Drives the setup screen. */
  async needsBootstrap(): Promise<boolean> {
    const count = await UserModel.countDocuments({
      role: { $in: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] },
    }).exec();
    return count === 0;
  }

  /**
   * Idempotent by REFUSAL, not by returning the same answer.
   *
   * Running twice cannot hand out a second set of credentials, because that
   * would be an unauthenticated way to mint an administrator on any deployment
   * where the first admin already exists. Once one exists, this is closed
   * forever — recovery is a database job, deliberately.
   */
  async bootstrap(): Promise<ServiceResult<BootstrapResult>> {
    if (!(await this.needsBootstrap())) {
      logger.warn('admin bootstrap attempted when an admin already exists');
      return fail(
        ERROR_CODES.ALREADY_EXISTS,
        MESSAGE_KEYS.auth.EMAIL_EXISTS,
        HTTP_STATUS.CONFLICT,
        { rejectionReason: 'admin_already_exists' },
      );
    }

    const email = 'admin@kinnijije.local';
    // 24 bytes of base64url — long enough that nobody is guessing it, short
    // enough to be typed by hand from a screen.
    const password = randomBytes(24).toString('base64url');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const existing = await UserModel.findOne({ email }).exec();
    if (existing !== null) {
      // The address is taken but held by a non-admin. Promoting it silently
      // would hand somebody else's account the console.
      return fail(
        ERROR_CODES.ALREADY_EXISTS,
        MESSAGE_KEYS.auth.EMAIL_EXISTS,
        HTTP_STATUS.CONFLICT,
        { rejectionReason: 'bootstrap_email_taken' },
      );
    }

    const user = await UserModel.create({
      email,
      passwordHash,
      name: 'Administrator',
      role: USER_ROLES.SUPER_ADMIN,
      // Active immediately: there is no inbox to verify against, and an admin
      // who cannot act is not an admin.
      status: USER_STATUSES.ACTIVE,
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
    });

    logger.info('first administrator created', { user_id: user._id, email });

    return ok({ email, password, user_id: user._id });
  }
}

export const adminAuthService = AdminAuthService.getInstance();
