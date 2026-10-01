import type { Request, Response } from 'express';

import { AuditLogModel } from '@lib/audit/index.js';
import { isoOrNull } from '@lib/dates.js';
import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireStaff } from '@shared/middleware/authenticate-staff.middleware.js';

import { StaffUserModel, type StaffTier } from './staff-user.model.js';
import { staffService } from './staff.service.js';

/**
 * The acting staff member, with their current scopes and name.
 *
 * Read fresh rather than taken from the token, for the same reason
 * `requireScope` does: the first escalation rule is "nobody grants what they
 * do not hold", and a stale scope set would let somebody grant something they
 * lost fifteen minutes ago.
 */
async function actingStaff(staffId: string): Promise<{
  id: string;
  name: string;
  email: string;
  tier: StaffTier;
  scopes: string[];
}> {
  const row = await StaffUserModel.findById(staffId, {
    name: 1,
    email: 1,
    tier: 1,
    permissions: 1,
  })
    .lean()
    .exec();

  return {
    id: staffId,
    name: row?.name ?? 'An administrator',
    email: row?.email ?? 'unknown',
    tier: row?.tier ?? 'moderator',
    scopes: row?.permissions ?? [],
  };
}

export const staffController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    const result = await staffService.list();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  groups: (_req: Request, res: Response): void => {
    ResponseUtil.ok(res, staffService.groups());
  },

  invite: async (req: Request, res: Response): Promise<void> => {
    const staff = requireStaff(req);
    const body = req.body as {
      email: string;
      name: string;
      tier: StaffTier;
      group_keys?: string[];
      scopes?: string[];
    };

    const result = await staffService.invite(
      {
        email: body.email,
        name: body.name,
        tier: body.tier,
        groupKeys: body.group_keys ?? [],
        scopes: body.scopes ?? [],
      },
      await actingStaff(staff.staffId),
    );

    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  revokeInvite: async (req: Request, res: Response): Promise<void> => {
    const staff = requireStaff(req);
    const { staffId } = req.params as { staffId: string };
    const result = await staffService.revokeInvite(staffId, staff.staffId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  revokeAccess: async (req: Request, res: Response): Promise<void> => {
    const actor = requireStaff(req);
    const { staffId } = req.params as { staffId: string };
    const { reason } = req.body as { reason?: string };

    const result = await staffService.revokeAccess(staffId, reason ?? null, {
      id: actor.staffId,
      email: actor.email,
      tier: actor.tier,
    });

    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  setPermissions: async (req: Request, res: Response): Promise<void> => {
    const actor = requireStaff(req);
    const { staffId } = req.params as { staffId: string };
    const body = req.body as { group_keys?: string[]; scopes?: string[] };

    const acting = await actingStaff(actor.staffId);
    const result = await staffService.setPermissions(
      staffId,
      { groupKeys: body.group_keys ?? [], scopes: body.scopes ?? [] },
      { id: acting.id, email: acting.email, tier: acting.tier, scopes: acting.scopes },
    );

    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  // ── Invite acceptance: PUBLIC, by necessity ────────────────────────
  peekInvite: async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params as { token: string };
    const result = await staffService.peek(token);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  acceptInvite: async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params as { token: string };
    const { password } = req.body as { password: string };
    const result = await staffService.accept(token, password);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  // ── The trail ──────────────────────────────────────────────────────
  auditLog: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (query['actor_id'] !== undefined) filter['actorId'] = query['actor_id'];
    if (query['resource'] !== undefined) filter['resource'] = query['resource'];
    if (query['action'] !== undefined) filter['action'] = query['action'];
    if (query['outcome'] !== undefined) filter['outcome'] = query['outcome'];

    const limit = Math.min(Number(query['limit'] ?? 50) || 50, 200);
    const skip = Math.max(Number(query['skip'] ?? 0) || 0, 0);

    const [rows, total] = await Promise.all([
      AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      AuditLogModel.countDocuments(filter).exec(),
    ]);

    ResponseUtil.ok(
      res,
      rows.map((row) => ({
        id: row._id,
        actor_id: row.actorId,
        actor_email: row.actorEmail,
        actor_role: row.actorRole,
        action: row.action,
        resource: row.resource,
        resource_id: row.resourceId,
        changes: row.changes,
        meta: row.meta,
        outcome: row.outcome,
        method: row.method,
        path: row.path,
        request_id: row.requestId,
        created_at: isoOrNull(row.createdAt),
      })),
      { next_cursor: null, has_more: skip + rows.length < total },
    );
  },
};
