import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

import { record } from '@lib/audit/index.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { hashRefreshToken, refreshTokenTtlSeconds } from '@lib/tokens.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import {
  STAFF_SESSION_ALLOWED,
  STAFF_STATUSES,
  STAFF_TIERS,
  StaffUserModel,
} from '../staff/staff-user.model.js';
import { StaffSessionModel } from './staff-session.model.js';
import { signStaffToken, staffAccessTtlSeconds } from './staff-tokens.js';

export interface StaffSession {
  staff: {
    id: string;
    email: string;
    name: string;
    tier: string;
    status: string;
    permissions: string[];
    group_keys: string[];
  };
  tokens: {
    access_token: string;
    refresh_token: string;
    token_type: 'Bearer';
    expires_in: number;
  };
}

export interface BootstrapResult {
  email: string;
  password: string;
  staff_id: string;
}

/**
 * NOTE: no per-account lockout counter here, unlike customer login.
 *
 * The route carries the LOGIN rate-limit policy, keyed by IP and by email,
 * which is what actually bounds credential guessing. A second counter on the
 * row would add a way to lock a colleague out of the console by guessing at
 * their address, which is a worse trade on a surface this small.
 */

export class StaffAuthService {
  private static instance: StaffAuthService | undefined;

  static getInstance(): StaffAuthService {
    StaffAuthService.instance ??= new StaffAuthService();
    return StaffAuthService.instance;
  }

  /** Whether the console still has nobody in it. Drives the setup screen. */
  async needsBootstrap(): Promise<boolean> {
    return (await StaffUserModel.countDocuments().exec()) === 0;
  }

  /**
   * Creates the very first console account.
   *
   * Still necessary with `staff_users` separated: with the collection empty
   * there is nobody to invite anybody, so there has to be one way in that
   * needs no existing account.
   *
   * Idempotent BY REFUSAL rather than by returning the same answer — running
   * it twice must not be an unauthenticated way to mint a second owner. Once
   * one staff row exists this is closed permanently.
   */
  async bootstrap(): Promise<ServiceResult<BootstrapResult>> {
    if (!(await this.needsBootstrap())) {
      logger.warn('console bootstrap attempted when staff already exist');
      return fail(ERROR_CODES.ALREADY_EXISTS, MESSAGE_KEYS.auth.EMAIL_EXISTS, HTTP_STATUS.CONFLICT, {
        rejectionReason: 'staff_already_exists',
      });
    }

    const email = 'admin@kinnijije.local';
    // 24 bytes of base64url: unguessable, and short enough to type off a screen.
    const password = randomBytes(24).toString('base64url');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const staff = await StaffUserModel.create({
      email,
      passwordHash,
      name: 'Administrator',
      tier: STAFF_TIERS.SUPER_ADMIN,
      status: STAFF_STATUSES.ACTIVE,
    });

    logger.info('first console account created', { staff_id: staff._id, email });
    // Shown ONCE, on screen. Never emailed, never recoverable.
    return ok({ email, password, staff_id: staff._id });
  }

  async login(
    input: { email: string; password: string },
    origin: { userAgent: string | null; ip: string | null },
  ): Promise<ServiceResult<StaffSession>> {
    const email = input.email.trim().toLowerCase();
    const staff = await StaffUserModel.findOne({ email }).select('+passwordHash').exec();

    /**
     * One rejection for every failure mode.
     *
     * No such account, an invitation not yet accepted (no password), a
     * suspended account — all return `invalid_credentials`. Telling them apart
     * would turn this endpoint into a way to enumerate who works here and who
     * has an invitation outstanding.
     */
    const invalid = () =>
      fail(ERROR_CODES.INVALID_CREDENTIALS, MESSAGE_KEYS.auth.INVALID_CREDENTIALS, HTTP_STATUS.UNAUTHORIZED, {
        rejectionReason: 'staff_login_failed',
      });

    if (staff === null) return invalid();
    if (staff.passwordHash === null) return invalid();
    if (!STAFF_SESSION_ALLOWED.includes(staff.status)) return invalid();

    const matches = await argon2.verify(staff.passwordHash, input.password).catch(() => false);
    if (!matches) {
      logger.warn('failed console login', { staff_id: staff._id });
      record({
        action: 'staff.login.failed',
        resource: 'staff',
        resourceId: staff._id,
        outcome: 'denied',
        actor: { id: staff._id, email: staff.email, role: staff.tier },
      });
      return invalid();
    }

    const refreshToken = randomBytes(48).toString('base64url');
    const session = await StaffSessionModel.create({
      staffId: staff._id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      userAgent: origin.userAgent,
      ip: origin.ip,
      expiresAt: new Date(Date.now() + refreshTokenTtlSeconds() * 1000),
    });

    staff.lastConsoleLoginAt = new Date();
    await staff.save();

    logger.info('console login', { staff_id: staff._id });

    return ok({
      staff: {
        id: staff._id,
        email: staff.email,
        name: staff.name,
        tier: staff.tier,
        status: staff.status,
        permissions: staff.permissions,
        group_keys: staff.permissionGroupKeys,
      },
      tokens: {
        access_token: signStaffToken({
          sub: staff._id,
          tier: staff.tier,
          status: staff.status,
          sid: session._id,
        }),
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: staffAccessTtlSeconds(),
      },
    });
  }

  async refresh(
    refreshToken: string,
    origin: { userAgent: string | null; ip: string | null },
  ): Promise<ServiceResult<StaffSession>> {
    const session = await StaffSessionModel.findOne({
      refreshTokenHash: hashRefreshToken(refreshToken),
    }).exec();

    if (session === null || session.revokedAt !== null || session.expiresAt < new Date()) {
      return fail(ERROR_CODES.TOKEN_INVALID, MESSAGE_KEYS.auth.TOKEN_INVALID, HTTP_STATUS.UNAUTHORIZED, {
        rejectionReason: 'staff_session_not_open',
      });
    }

    const staff = await StaffUserModel.findById(session.staffId).exec();
    if (staff === null || !STAFF_SESSION_ALLOWED.includes(staff.status)) {
      return fail(ERROR_CODES.SESSION_REVOKED, MESSAGE_KEYS.auth.SESSION_REVOKED, HTTP_STATUS.UNAUTHORIZED, {
        rejectionReason: 'staff_no_longer_active',
      });
    }

    // Rotated: a refresh token is single-use, so a stolen one is useful once
    // and then stops working — and the theft shows up as a failed refresh.
    const nextToken = randomBytes(48).toString('base64url');
    session.refreshTokenHash = hashRefreshToken(nextToken);
    session.userAgent = origin.userAgent;
    session.ip = origin.ip;
    await session.save();

    return ok({
      staff: {
        id: staff._id,
        email: staff.email,
        name: staff.name,
        tier: staff.tier,
        status: staff.status,
        permissions: staff.permissions,
        group_keys: staff.permissionGroupKeys,
      },
      tokens: {
        access_token: signStaffToken({
          sub: staff._id,
          tier: staff.tier,
          status: staff.status,
          sid: session._id,
        }),
        refresh_token: nextToken,
        token_type: 'Bearer',
        expires_in: staffAccessTtlSeconds(),
      },
    });
  }

  async logout(refreshToken: string): Promise<ServiceResult<null>> {
    await StaffSessionModel.updateOne(
      { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
    ).exec();
    // Always succeeds: a logout that 404s tells somebody their token was
    // already dead, which is not information worth giving out.
    return ok(null);
  }

  /** Ends every console session for one person. Used when access changes. */
  async revokeAllSessions(staffId: string, reason: string): Promise<number> {
    const result = await StaffSessionModel.updateMany(
      { staffId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: reason } },
    ).exec();
    return result.modifiedCount;
  }
}

export const staffAuthService = StaffAuthService.getInstance();
