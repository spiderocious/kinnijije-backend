import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

import { UserModel } from '@features/users/users.model.js';
import { authRepository } from '@features/auth/auth.repo.js';
import { record } from '@lib/audit/index.js';
import { isoOrNull } from '@lib/dates.js';
import { EMAIL_KINDS, emailService } from '@lib/mail/index.js';
import { staffInviteEmail } from '@lib/mail/templates.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { hashRefreshToken } from '@lib/tokens.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';
import { OWNER_ONLY_SCOPES, SEEDED_GROUPS } from '@shared/constants/permission-groups.js';
import { expand, sanitise, type Scope } from '@shared/constants/permissions.js';
import { USER_ROLES, USER_STATUSES, roleAtLeast, type UserRole } from '@shared/constants/roles.js';

import { StaffInviteModel } from './staff-invite.model.js';

/** Seven days. Long enough to survive a holiday, short enough to expire. */
const INVITE_TTL_DAYS = 7;

export interface StaffRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  permissions: string[];
  group_keys: string[];
  last_login_at: string | null;
  created_at: string | null;
  /** Present only while an invitation is outstanding. */
  invite: { expires_at: string | null; expired: boolean; invited_by: string } | null;
}

/**
 * Staff, invitations and permissions.
 *
 * The escalation rules live HERE rather than at the route, because they depend
 * on what the actor holds and on how many super admins remain — neither of
 * which a middleware can see.
 */
export class StaffService {
  private static instance: StaffService | undefined;

  static getInstance(): StaffService {
    StaffService.instance ??= new StaffService();
    return StaffService.instance;
  }

  /** Resolve group keys to a flattened scope set, dropping anything unknown. */
  private scopesFor(groupKeys: readonly string[], extraScopes: readonly string[]): Scope[] {
    const fromGroups = groupKeys.flatMap(
      (key) => SEEDED_GROUPS.find((group) => group.key === key)?.scopes ?? [],
    );
    return [...new Set([...fromGroups, ...sanitise(extraScopes)])];
  }

  /**
   * Whether the actor may confer this exact set.
   *
   * Two rules, and they are the whole of privilege-escalation defence:
   *   1. Nobody grants a scope they do not themselves hold — checked against
   *      EFFECTIVE scopes, so holding `recipes:delete` does let you grant
   *      `recipes:read`.
   *   2. `staff:write` and `settings:write` are super-admin only, because the
   *      first is the power to grant and the second reaches the mail provider
   *      and the ranking every user is served by.
   */
  private mayGrant(
    actorRole: UserRole,
    actorScopes: readonly string[],
    wanted: readonly Scope[],
  ): { ok: true } | { ok: false; scope: Scope; reason: string } {
    if (actorRole === USER_ROLES.SUPER_ADMIN) return { ok: true };

    const effective = new Set(expand(actorScopes));

    for (const scope of wanted) {
      if (OWNER_ONLY_SCOPES.includes(scope)) {
        return { ok: false, scope, reason: 'owner_only_scope' };
      }
      if (!effective.has(scope)) {
        return { ok: false, scope, reason: 'actor_does_not_hold_scope' };
      }
    }
    return { ok: true };
  }

  async list(): Promise<ServiceResult<StaffRow[]>> {
    const staff = await UserModel.find(
      { role: { $in: [USER_ROLES.MODERATOR, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] } },
      {
        email: 1,
        name: 1,
        role: 1,
        status: 1,
        permissions: 1,
        permissionGroupKeys: 1,
        lastLoginAt: 1,
        createdAt: 1,
      },
    )
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    // One query for every outstanding invite rather than one per row.
    const invites = await StaffInviteModel.find(
      { userId: { $in: staff.map((row) => row._id) }, usedAt: null, revokedAt: null },
      { userId: 1, expiresAt: 1, invitedBy: 1 },
    )
      .lean()
      .exec();
    const inviteByUser = new Map(invites.map((invite) => [invite.userId, invite]));

    return ok(
      staff.map((row) => {
        const invite = inviteByUser.get(row._id);
        return {
          id: row._id,
          email: row.email,
          name: row.name,
          role: row.role,
          status: row.status,
          permissions: row.permissions ?? [],
          group_keys: row.permissionGroupKeys ?? [],
          last_login_at: isoOrNull(row.lastLoginAt),
          created_at: isoOrNull(row.createdAt),
          invite:
            invite === undefined
              ? null
              : {
                  expires_at: isoOrNull(invite.expiresAt),
                  // Shown rather than hidden: somebody has to chase it.
                  expired: invite.expiresAt.getTime() < Date.now(),
                  invited_by: invite.invitedBy,
                },
        };
      }),
    );
  }

  async invite(
    input: { email: string; name: string; role: UserRole; groupKeys: string[]; scopes: string[] },
    actor: { id: string; name: string; role: UserRole; scopes: readonly string[] },
  ): Promise<ServiceResult<{ user_id: string; invite_id: string }>> {
    const email = input.email.trim().toLowerCase();

    // Rule: nobody creates a peer or a superior.
    if (actor.role !== USER_ROLES.SUPER_ADMIN && roleAtLeast(input.role, actor.role)) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.INSUFFICIENT_ROLE, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: `cannot_invite_${input.role}_as_${actor.role}`,
      });
    }

    const wanted = this.scopesFor(input.groupKeys, input.scopes);
    const permitted = this.mayGrant(actor.role, actor.scopes, wanted);
    if (!permitted.ok) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: `${permitted.reason}_${permitted.scope}`,
      });
    }

    const existing = await UserModel.findOne({ email }).exec();

    // An address already holding a real account is not re-invited: promoting
    // somebody else's customer account into the console silently would be a
    // takeover, not an invitation.
    if (existing !== null && existing.status !== USER_STATUSES.INVITED) {
      return fail(ERROR_CODES.ALREADY_EXISTS, MESSAGE_KEYS.auth.EMAIL_EXISTS, HTTP_STATUS.CONFLICT, {
        rejectionReason: 'email_already_has_an_account',
      });
    }

    const user =
      existing ??
      (await UserModel.create({
        email,
        name: input.name.trim(),
        role: input.role,
        // No password yet — that is what `invited` means, and why
        // `passwordHash` had to become optional.
        status: USER_STATUSES.INVITED,
        permissions: wanted,
        permissionGroupKeys: input.groupKeys,
      }));

    if (existing !== null) {
      // Re-inviting: refresh what is on offer, and withdraw the old token.
      // Two live invitations for one person is two ways in.
      await UserModel.updateOne(
        { _id: user._id },
        { $set: { name: input.name.trim(), role: input.role, permissions: wanted, permissionGroupKeys: input.groupKeys } },
      ).exec();
      await StaffInviteModel.updateMany(
        { userId: user._id, usedAt: null, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      ).exec();
    }

    const token = randomBytes(48).toString('base64url');
    const invite = await StaffInviteModel.create({
      userId: user._id,
      email,
      tokenHash: hashRefreshToken(token),
      scopes: wanted,
      groupKeys: input.groupKeys,
      role: input.role,
      invitedBy: actor.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    });

    const groupLabel =
      SEEDED_GROUPS.find((group) => group.key === input.groupKeys[0])?.name ?? 'Staff';

    emailService.dispatch({
      kind: EMAIL_KINDS.STAFF_INVITE,
      to: email,
      // Null would be correct too, but the row exists, so attribute it.
      ownerId: user._id,
      content: staffInviteEmail(input.name, token, actor.name, groupLabel),
    });

    record({
      action: 'staff.invited',
      resource: 'staff',
      resourceId: user._id,
      meta: { email, role: input.role, groups: input.groupKeys, scopes: wanted },
    });

    logger.info('staff invited', { user_id: user._id, invited_by: actor.id });
    return ok({ user_id: user._id, invite_id: invite._id });
  }

  /** What the accept-invite page may show. Name and email only. */
  async peek(token: string): Promise<ServiceResult<{ email: string; name: string }>> {
    const invite = await StaffInviteModel.findOne({
      tokenHash: hashRefreshToken(token),
      usedAt: null,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .lean()
      .exec();

    if (invite === null) {
      return fail(ERROR_CODES.TOKEN_INVALID, MESSAGE_KEYS.auth.TOKEN_INVALID, HTTP_STATUS.UNAUTHORIZED, {
        rejectionReason: 'invite_not_open',
      });
    }

    const user = await UserModel.findById(invite.userId, { name: 1, email: 1 }).lean().exec();
    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // Deliberately NOT the scopes or who invited them: an unauthenticated
    // endpoint should not describe the shape of the organisation.
    return ok({ email: user.email, name: user.name });
  }

  async accept(token: string, password: string): Promise<ServiceResult<null>> {
    const tokenHash = hashRefreshToken(token);
    const invite = await StaffInviteModel.findOne({
      tokenHash,
      usedAt: null,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).exec();

    if (invite === null) {
      return fail(ERROR_CODES.TOKEN_INVALID, MESSAGE_KEYS.auth.TOKEN_INVALID, HTTP_STATUS.UNAUTHORIZED, {
        rejectionReason: 'invite_not_open',
      });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await UserModel.updateOne(
      { _id: invite.userId },
      {
        $set: {
          passwordHash,
          status: USER_STATUSES.ACTIVE,
          // Clicking a link sent to the address IS the verification.
          emailVerifiedAt: new Date(),
          onboardingCompletedAt: new Date(),
          // From the invite, not from the group — see the model's note on why
          // the offer is snapshotted.
          permissions: invite.scopes,
          permissionGroupKeys: invite.groupKeys,
          role: invite.role,
        },
      },
    ).exec();

    // Marked used only AFTER the account is usable, so a failure mid-way
    // leaves the invite spendable rather than burning it.
    invite.usedAt = new Date();
    await invite.save();

    record({
      action: 'staff.invite.accepted',
      resource: 'staff',
      resourceId: invite.userId,
      actor: { id: invite.userId, email: invite.email, role: invite.role },
    });

    logger.info('staff invite accepted', { user_id: invite.userId });
    return ok(null);
  }

  async revokeInvite(userId: string, actorId: string): Promise<ServiceResult<null>> {
    const result = await StaffInviteModel.updateMany(
      { userId, usedAt: null, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    ).exec();

    if (result.modifiedCount === 0) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND, {
        rejectionReason: 'no_open_invite',
      });
    }

    record({ action: 'staff.invite.revoked', resource: 'staff', resourceId: userId });
    logger.info('staff invite revoked', { user_id: userId, by: actorId });
    return ok(null);
  }

  async setPermissions(
    targetUserId: string,
    input: { groupKeys: string[]; scopes: string[] },
    actor: { id: string; role: UserRole; scopes: readonly string[] },
  ): Promise<ServiceResult<null>> {
    // Nobody edits their own permissions. Same rule as self-role-change, and
    // the same reason: it is the escalation path.
    if (targetUserId === actor.id) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: 'self_permission_change',
      });
    }

    const target = await UserModel.findById(targetUserId, { permissions: 1, role: 1 }).exec();
    if (target === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // A super admin's scopes are meaningless (they bypass), so editing them
    // would imply a restriction that does not exist.
    if (target.role === USER_ROLES.SUPER_ADMIN && actor.role !== USER_ROLES.SUPER_ADMIN) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.INSUFFICIENT_ROLE, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: 'cannot_edit_a_super_admin',
      });
    }

    const wanted = this.scopesFor(input.groupKeys, input.scopes);
    const permitted = this.mayGrant(actor.role, actor.scopes, wanted);
    if (!permitted.ok) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: `${permitted.reason}_${permitted.scope}`,
      });
    }

    const before = target.permissions ?? [];
    await UserModel.updateOne(
      { _id: targetUserId },
      { $set: { permissions: wanted, permissionGroupKeys: input.groupKeys } },
    ).exec();

    /**
     * Sessions revoked so the change bites immediately.
     *
     * `requireScope` reads permissions from the database, so a narrowed scope
     * already takes effect on the next request — this is belt and braces, and
     * it forces a re-login so the person sees their new console rather than a
     * half-working one.
     */
    await authRepository.revokeAllSessionsForUser(targetUserId, 'role_change');

    record({
      action: 'staff.permissions.changed',
      resource: 'staff',
      resourceId: targetUserId,
      changes: [{ field: 'permissions', from: before, to: wanted }],
    });

    logger.info('staff permissions changed', { user_id: targetUserId, by: actor.id });
    return ok(null);
  }

  /** The groups an operator may pick from, with what each confers spelled out. */
  groups(): { key: string; name: string; description: string; scopes: string[]; effective: string[] }[] {
    return SEEDED_GROUPS.map((group) => ({
      key: group.key,
      name: group.name,
      description: group.description,
      scopes: [...group.scopes],
      // The console must show that granting delete also granted read + write.
      effective: expand(group.scopes),
    }));
  }
}

export const staffService = StaffService.getInstance();
