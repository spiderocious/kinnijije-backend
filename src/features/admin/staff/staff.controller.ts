import type { Request, Response } from 'express';

import { AuditLogModel } from '@lib/audit/index.js';
import { isoOrNull } from '@lib/dates.js';
import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';
import { UserModel } from '@features/users/users.model.js';
import type { UserRole } from '@shared/constants/roles.js';

import { staffService } from './staff.service.js';

/**
 * The actor's own effective scopes.
 *
 * Needed by every grant, because the first escalation rule is "nobody grants
 * what they do not hold". Read fresh rather than taken from the token, for the
 * same reason `requireScope` does.
 */
async function actorScopes(userId: string): Promise<string[]> {
  const row = await UserModel.findById(userId, { permissions: 1, name: 1 }).lean().exec();
  return row?.permissions ?? [];
}

async function actorName(userId: string): Promise<string> {
  const row = await UserModel.findById(userId, { name: 1 }).lean().exec();
  return row?.name ?? 'An administrator';
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
    const actor = requireActor(req);
    const body = req.body as {
      email: string;
      name: string;
      role: UserRole;
      group_keys?: string[];
      scopes?: string[];
    };

    const result = await staffService.invite(
      {
        email: body.email,
        name: body.name,
        role: body.role,
        groupKeys: body.group_keys ?? [],
        scopes: body.scopes ?? [],
      },
      {
        id: actor.userId,
        name: await actorName(actor.userId),
        role: actor.role,
        scopes: await actorScopes(actor.userId),
      },
    );

    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  revokeInvite: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { userId } = req.params as { userId: string };
    const result = await staffService.revokeInvite(userId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  setPermissions: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { userId } = req.params as { userId: string };
    const body = req.body as { group_keys?: string[]; scopes?: string[] };

    const result = await staffService.setPermissions(
      userId,
      { groupKeys: body.group_keys ?? [], scopes: body.scopes ?? [] },
      { id: actor.userId, role: actor.role, scopes: await actorScopes(actor.userId) },
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
      // The envelope's meta is cursor-shaped, so the count rides in the rows'
      // own pagination rather than inventing a field for it.
      { next_cursor: null, has_more: skip + rows.length < total },
    );
  },
};
