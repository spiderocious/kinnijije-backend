import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

import { UserModel } from '@features/users/users.model.js';
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

import { staffAuthService } from '../auth/staff-auth.service.js';
import { StaffInviteModel } from './staff-invite.model.js';
import {
  STAFF_STATUSES,
  STAFF_TIERS,
  StaffUserModel,
  tierAtLeast,
  type StaffTier,
} from './staff-user.model.js';

/** Seven days. Long enough to survive a holiday, short enough to expire. */
const INVITE_TTL_DAYS = 7;

export interface StaffRow {
  id: string;
  email: string;
  name: string;
  tier: string;
  status: string;
  permissions: string[];
  group_keys: string[];
  last_console_login_at: string | null;
  created_at: string | null;
  /**
   * Whether this person also has a customer account.
   *
   * Context only. It confers nothing and is never read when authorising — the
   * two identities are separate by design.
   */
  has_customer_account: boolean;
  invite: { expires_at: string | null; expired: boolean; invited_by: string | null } | null;
}

/**
 * Staff, invitations and permissions — all against `staff_users`.
 *
 * WHY THIS IS NOW SIMPLE: a console account is its own document. Inviting
 * somebody who already shops here inserts a staff row and touches their
 * customer account not at all, so there is no password to overwrite and no
 * "already has an account" refusal to make. The bug that guard existed to
 * prevent cannot happen.
 */
export class StaffService {
  private static instance: StaffService | undefined;

  static getInstance(): StaffService {
    StaffService.instance ??= new StaffService();
    return StaffService.instance;
  }

  private scopesFor(groupKeys: readonly string[], extraScopes: readonly string[]): Scope[] {
    const fromGroups = groupKeys.flatMap(
      (key) => SEEDED_GROUPS.find((group) => group.key === key)?.scopes ?? [],
    );
    return [...new Set([...fromGroups, ...sanitise(extraScopes)])];
  }

  /**
   * Whether the actor may confer this set. The whole of escalation defence:
   *
   *   1. Nobody grants a scope they do not themselves hold — checked against
   *      EFFECTIVE scopes, so holding `recipes:delete` does allow granting
   *      `recipes:read`.
   *   2. `staff:write`, `settings:write` and `scripts:write` are super-admin
   *      only: the first is the power to grant, and the others reach global
   *      data.
   */
  private mayGrant(
    actorTier: StaffTier,
    actorScopes: readonly string[],
    wanted: readonly Scope[],
  ): { ok: true } | { ok: false; scope: Scope; reason: string } {
    if (actorTier === STAFF_TIERS.SUPER_ADMIN) return { ok: true };

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
    const staff = await StaffUserModel.find().sort({ createdAt: -1 }).lean().exec();

    // One query for every outstanding invite rather than one per row.
    const invites = await StaffInviteModel.find(
      { staffId: { $in: staff.map((row) => row._id) }, usedAt: null, revokedAt: null },
      { staffId: 1, expiresAt: 1, invitedBy: 1 },
    )
      .lean()
      .exec();
    const inviteByStaff = new Map(invites.map((invite) => [invite.staffId, invite]));

    // Which of them also shop here — context for the console, nothing more.
    const customers = await UserModel.find(
      { email: { $in: staff.map((row) => row.email) } },
      { email: 1 },
    )
      .lean()
      .exec();
    const customerEmails = new Set(customers.map((row) => row.email));

    return ok(
      staff.map((row) => {
        const invite = inviteByStaff.get(row._id);
        return {
          id: row._id,
          email: row.email,
          name: row.name,
          tier: row.tier,
          status: row.status,
          permissions: row.permissions,
          group_keys: row.permissionGroupKeys,
          last_console_login_at: isoOrNull(row.lastConsoleLoginAt),
          created_at: isoOrNull(row.createdAt),
          has_customer_account: customerEmails.has(row.email),
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
    input: { email: string; name: string; tier: StaffTier; groupKeys: string[]; scopes: string[] },
    actor: { id: string; name: string; email: string; tier: StaffTier; scopes: readonly string[] },
  ): Promise<ServiceResult<{ staff_id: string; invite_id: string }>> {
    const email = input.email.trim().toLowerCase();

    // Nobody creates a peer or a superior.
    if (actor.tier !== STAFF_TIERS.SUPER_ADMIN && tierAtLeast(input.tier, actor.tier)) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.INSUFFICIENT_ROLE, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: `cannot_invite_${input.tier}_as_${actor.tier}`,
      });
    }

    const wanted = this.scopesFor(input.groupKeys, input.scopes);
    const permitted = this.mayGrant(actor.tier, actor.scopes, wanted);
    if (!permitted.ok) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: `${permitted.reason}_${permitted.scope}`,
      });
    }

    /**
     * An existing STAFF row is a re-invite. A customer with the same address is
     * irrelevant — different collection, different identity, nothing to
     * collide with. That is the whole point of the separation.
     */
    const existing = await StaffUserModel.findOne({ email }).exec();

    if (existing !== null && existing.status === STAFF_STATUSES.ACTIVE) {
      return fail(ERROR_CODES.ALREADY_EXISTS, MESSAGE_KEYS.auth.EMAIL_EXISTS, HTTP_STATUS.CONFLICT, {
        rejectionReason: 'already_on_staff',
      });
    }

    const linkedUserId = await UserModel.findOne({ email }, { _id: 1 })
      .lean()
      .exec()
      .then((row) => row?._id ?? null);

    const staff =
      existing ??
      (await StaffUserModel.create({
        email,
        name: input.name.trim(),
        tier: input.tier,
        // No password yet — that is what `invited` means.
        status: STAFF_STATUSES.INVITED,
        permissions: wanted,
        permissionGroupKeys: input.groupKeys,
        linkedUserId,
        invitedBy: actor.id,
      }));

    if (existing !== null) {
      // Re-inviting, or reviving a revoked colleague: refresh what is on
      // offer, and withdraw the old token. Two live invitations is two ways in.
      await StaffUserModel.updateOne(
        { _id: staff._id },
        {
          $set: {
            name: input.name.trim(),
            tier: input.tier,
            status: STAFF_STATUSES.INVITED,
            permissions: wanted,
            permissionGroupKeys: input.groupKeys,
            linkedUserId,
            invitedBy: actor.id,
          },
        },
      ).exec();
      await StaffInviteModel.updateMany(
        { staffId: staff._id, usedAt: null, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      ).exec();
    }

    const token = randomBytes(48).toString('base64url');
    const invite = await StaffInviteModel.create({
      staffId: staff._id,
      email,
      tokenHash: hashRefreshToken(token),
      scopes: wanted,
      groupKeys: input.groupKeys,
      tier: input.tier,
      invitedBy: actor.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    });

    const groupLabel =
      SEEDED_GROUPS.find((group) => group.key === input.groupKeys[0])?.name ?? 'Staff';

    emailService.dispatch({
      kind: EMAIL_KINDS.STAFF_INVITE,
      to: email,
      // Null: the recipient is not a `users` row, and this address may belong
      // to a customer whose account has nothing to do with this invitation.
      ownerId: null,
      content: staffInviteEmail(input.name, token, actor.name, groupLabel),
    });

    record({
      action: 'staff.invited',
      resource: 'staff',
      resourceId: staff._id,
      meta: {
        email,
        tier: input.tier,
        groups: input.groupKeys,
        scopes: wanted,
        // Worth recording: it tells a reader this person already shopped here,
        // which is exactly the case that used to be refused.
        had_customer_account: linkedUserId !== null,
      },
      actor: { id: actor.id, email: actor.email, role: actor.tier },
    });

    logger.info('staff invited', { staff_id: staff._id, invited_by: actor.id });
    return ok({ staff_id: staff._id, invite_id: invite._id });
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

    const staff = await StaffUserModel.findById(invite.staffId, { name: 1, email: 1 })
      .lean()
      .exec();
    if (staff === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // Deliberately NOT the scopes or who invited them: an unauthenticated
    // endpoint should not describe the shape of the organisation.
    return ok({ email: staff.email, name: staff.name });
  }

  /**
   * Accepting an invitation.
   *
   * Sets the password on the STAFF row. The person's customer account, if they
   * have one, is not read and not written — so their shopping password is
   * untouched and cannot be overwritten by anybody holding this link.
   */
  async accept(token: string, password: string): Promise<ServiceResult<null>> {
    const invite = await StaffInviteModel.findOne({
      tokenHash: hashRefreshToken(token),
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

    await StaffUserModel.updateOne(
      { _id: invite.staffId },
      {
        $set: {
          passwordHash,
          status: STAFF_STATUSES.ACTIVE,
          // From the invite, not the group: the offer was snapshotted so
          // editing a group mid-flight cannot change what was accepted.
          permissions: invite.scopes,
          permissionGroupKeys: invite.groupKeys,
          tier: invite.tier,
        },
      },
    ).exec();

    // Marked used only AFTER the account works, so a failure mid-way leaves
    // the invite spendable rather than burning it.
    invite.usedAt = new Date();
    await invite.save();

    record({
      action: 'staff.invite.accepted',
      resource: 'staff',
      resourceId: invite.staffId,
      actor: { id: invite.staffId, email: invite.email, role: invite.tier },
    });

    logger.info('staff invite accepted', { staff_id: invite.staffId });
    return ok(null);
  }

  async revokeInvite(staffId: string, actorId: string): Promise<ServiceResult<null>> {
    const result = await StaffInviteModel.updateMany(
      { staffId, usedAt: null, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    ).exec();

    if (result.modifiedCount === 0) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND, {
        rejectionReason: 'no_open_invite',
      });
    }

    record({ action: 'staff.invite.revoked', resource: 'staff', resourceId: staffId });
    logger.info('staff invite revoked', { staff_id: staffId, by: actorId });
    return ok(null);
  }

  /**
   * Removing console access.
   *
   * The row survives, so the audit trail still resolves who they were — a
   * deleted actor renders as nothing at all, which defeats the point of the
   * trail. Their customer account, if any, is untouched: they stop being staff
   * and carry on being a cook.
   */
  async revokeAccess(
    staffId: string,
    reason: string | null,
    actor: { id: string; email: string; tier: StaffTier },
  ): Promise<ServiceResult<null>> {
    if (staffId === actor.id) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: 'self_revoke',
      });
    }

    const target = await StaffUserModel.findById(staffId, { tier: 1, status: 1 }).lean().exec();
    if (target === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    if (await this.wouldOrphanConsole(staffId)) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: 'last_super_admin',
      });
    }

    await StaffUserModel.updateOne(
      { _id: staffId },
      { $set: { status: STAFF_STATUSES.REVOKED, statusReason: reason } },
    ).exec();

    const ended = await staffAuthService.revokeAllSessions(staffId, 'status_change');

    record({
      action: 'staff.access.revoked',
      resource: 'staff',
      resourceId: staffId,
      changes: [{ field: 'status', from: target.status, to: STAFF_STATUSES.REVOKED }],
      meta: { reason, sessions_ended: ended },
      actor: { id: actor.id, email: actor.email, role: actor.tier },
    });

    logger.info('staff access revoked', { staff_id: staffId, by: actor.id, sessions_ended: ended });
    return ok(null);
  }

  /**
   * Whether removing this person leaves nobody who can administer the console.
   *
   * `bootstrap` only ever mints ONE super admin and then closes forever, so
   * losing the last one means recovery is a database job.
   */
  private async wouldOrphanConsole(staffId: string): Promise<boolean> {
    const target = await StaffUserModel.findById(staffId, { tier: 1, status: 1 }).lean().exec();
    if (target === null) return false;
    if (target.tier !== STAFF_TIERS.SUPER_ADMIN || target.status !== STAFF_STATUSES.ACTIVE) {
      return false;
    }
    const others = await StaffUserModel.countDocuments({
      _id: { $ne: staffId },
      tier: STAFF_TIERS.SUPER_ADMIN,
      status: STAFF_STATUSES.ACTIVE,
    }).exec();
    return others === 0;
  }

  async setPermissions(
    staffId: string,
    input: { groupKeys: string[]; scopes: string[] },
    actor: { id: string; email: string; tier: StaffTier; scopes: readonly string[] },
  ): Promise<ServiceResult<null>> {
    // Nobody edits their own permissions — that is the escalation path.
    if (staffId === actor.id) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: 'self_permission_change',
      });
    }

    const target = await StaffUserModel.findById(staffId, { permissions: 1, tier: 1 }).exec();
    if (target === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // A super admin's scopes are meaningless (they bypass), so editing them
    // would imply a restriction that does not exist.
    if (target.tier === STAFF_TIERS.SUPER_ADMIN && actor.tier !== STAFF_TIERS.SUPER_ADMIN) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.INSUFFICIENT_ROLE, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: 'cannot_edit_a_super_admin',
      });
    }

    const wanted = this.scopesFor(input.groupKeys, input.scopes);
    const permitted = this.mayGrant(actor.tier, actor.scopes, wanted);
    if (!permitted.ok) {
      return fail(ERROR_CODES.FORBIDDEN, MESSAGE_KEYS.access.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {
        rejectionReason: `${permitted.reason}_${permitted.scope}`,
      });
    }

    const before = target.permissions;
    await StaffUserModel.updateOne(
      { _id: staffId },
      { $set: { permissions: wanted, permissionGroupKeys: input.groupKeys } },
    ).exec();

    /**
     * Sessions ended so the change bites immediately.
     *
     * `requireScope` already reads permissions per request, so a narrowed
     * scope takes effect on the next call — this forces a re-login so the
     * person sees their new console rather than a half-working one.
     */
    await staffAuthService.revokeAllSessions(staffId, 'role_change');

    record({
      action: 'staff.permissions.changed',
      resource: 'staff',
      resourceId: staffId,
      changes: [{ field: 'permissions', from: before, to: wanted }],
      actor: { id: actor.id, email: actor.email, role: actor.tier },
    });

    logger.info('staff permissions changed', { staff_id: staffId, by: actor.id });
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
