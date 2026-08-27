import type { AuthRepository } from '@features/auth/auth.repo.js';
import { authRepository } from '@features/auth/auth.repo.js';
import { logger } from '@lib/logger/index.js';
import type { Mailer} from '@lib/mail/mailer.js';
import { mailer } from '@lib/mail/mailer.js';
import { statusChangedEmail } from '@lib/mail/templates.js';
import { clampLimit, MAX_ADMIN_PAGE_SIZE } from '@lib/pagination.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import {
  isValidStatusTransition,
  SESSION_ALLOWED_STATUSES,
  type UserRole,
  type UserStatus,
} from '@shared/constants/roles.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import type { UsersRepository } from './users.repo.js';
import { usersRepository } from './users.repo.js';
import type { ListUsersQuery, UpdateProfileInput } from './users.schema.js';
import { toUserView, type UserView } from './users.types.js';

export interface UserListResult {
  users: UserView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class UsersService {
  private constructor(
    private readonly repo: UsersRepository = usersRepository,
    private readonly authRepo: AuthRepository = authRepository,
    private readonly mail: Mailer = mailer,
  ) {}

  private static instance: UsersService | undefined;

  static getInstance(): UsersService {
    UsersService.instance ??= new UsersService();
    return UsersService.instance;
  }

  async getById(userId: string): Promise<ServiceResult<UserView>> {
    const user = await this.repo.findById(userId);
    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(toUserView(user));
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<ServiceResult<UserView>> {
    const updated = await this.repo.updateProfile(userId, input);
    if (updated === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(toUserView(updated));
  }

  async list(query: ListUsersQuery): Promise<ServiceResult<UserListResult>> {
    const page = await this.repo.list({
      limit: clampLimit(query.limit, MAX_ADMIN_PAGE_SIZE),
      ...(query.cursor !== undefined && { cursor: query.cursor }),
      ...(query.role !== undefined && { role: query.role as UserRole }),
      ...(query.status !== undefined && { status: query.status as UserStatus }),
    });

    return ok({
      users: page.users.map(toUserView),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  }

  /**
   * Status is the permission axis, so changing it is the most consequential
   * thing an admin can do here. Two rules make it safe:
   *
   *  1. The transition must be legal. A client-sent status is untrusted, and
   *     the model's enum only constrains the value, not the move.
   *  2. Moving a user out of session-eligible statuses revokes their sessions
   *     immediately — otherwise a banned user keeps acting until their access
   *     token expires.
   */
  async updateStatus(
    targetUserId: string,
    nextStatus: UserStatus,
    reason: string | null,
  ): Promise<ServiceResult<UserView>> {
    const user = await this.repo.findById(targetUserId);
    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const currentStatus = user.status;

    if (currentStatus === nextStatus) {
      return ok(toUserView(user));
    }

    if (!isValidStatusTransition(currentStatus, nextStatus)) {
      return fail(
        ERROR_CODES.VALIDATION_ERROR,
        MESSAGE_KEYS.common.VALIDATION_ERROR,
        HTTP_STATUS.UNPROCESSABLE,
        {
          fieldErrors: { status: [`Cannot move an account from ${currentStatus} to ${nextStatus}`] },
          rejectionReason: `illegal_transition_${currentStatus}_to_${nextStatus}`,
        },
      );
    }

    const updated = await this.repo.updateStatus(targetUserId, nextStatus, reason);
    if (updated === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    if (!SESSION_ALLOWED_STATUSES.includes(nextStatus)) {
      const revoked = await this.authRepo.revokeAllSessionsForUser(targetUserId, 'status_change');
      logger.info('sessions revoked on status change', {
        user_id: targetUserId,
        status: nextStatus,
        revoked_count: revoked,
      });
    }

    this.mail.dispatch({
      to: updated.email,
      content: statusChangedEmail(updated.name, nextStatus, reason ?? undefined),
    });

    return ok(toUserView(updated));
  }

  async updateRole(
    targetUserId: string,
    actingUserId: string,
    nextRole: UserRole,
  ): Promise<ServiceResult<UserView>> {
    // Self-demotion is how an organisation locks itself out of its own admin
    // tooling. Refused outright; another super admin can do it.
    if (targetUserId === actingUserId) {
      return fail(
        ERROR_CODES.FORBIDDEN,
        MESSAGE_KEYS.users.CANNOT_DEMOTE_SELF,
        HTTP_STATUS.FORBIDDEN,
        { rejectionReason: 'self_role_change' },
      );
    }

    const updated = await this.repo.updateRole(targetUserId, nextRole);
    if (updated === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // The old access token still carries the old role until it expires. The
    // sessions go so the next refresh mints correct claims.
    const revoked = await this.authRepo.revokeAllSessionsForUser(targetUserId, 'role_change');
    logger.info('sessions revoked on role change', {
      user_id: targetUserId,
      role: nextRole,
      revoked_count: revoked,
    });

    return ok(toUserView(updated));
  }
}

export const usersService = UsersService.getInstance();
