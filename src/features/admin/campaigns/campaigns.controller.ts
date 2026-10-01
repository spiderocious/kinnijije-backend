import type { Request, Response } from 'express';

import { UserModel } from '@features/users/users.model.js';
import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import type { EmailKind } from '@lib/mail/email-log.model.js';
import { requireStaff } from '@shared/middleware/authenticate-staff.middleware.js';

import { StaffUserModel } from '../staff/staff-user.model.js';
import { BUILDABLE_KINDS } from './email-builders.js';
import { campaignsService } from './campaigns.service.js';

/** The acting staff member, for the audit trail. */
async function actingStaff(staffId: string): Promise<{ id: string; email: string; tier: string }> {
  const row = await StaffUserModel.findById(staffId, { email: 1, tier: 1 }).lean().exec();
  return { id: staffId, email: row?.email ?? 'unknown', tier: row?.tier ?? 'unknown' };
}

export const campaignsController = {
  /** The domain dashboard: every kind, its schedule, rules and last run. */
  overview: async (_req: Request, res: Response): Promise<void> => {
    const result = await campaignsService.overview();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  /** Which kinds the pipeline can build. Drives the composer's picker. */
  kinds: (_req: Request, res: Response): void => {
    ResponseUtil.ok(res, BUILDABLE_KINDS);
  },

  listBatches: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as { kind?: string; status?: string; limit?: string };
    const result = await campaignsService.list({
      ...(query.kind !== undefined && { kind: query.kind }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.limit !== undefined && { limit: Number(query.limit) }),
    });
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  batch: async (req: Request, res: Response): Promise<void> => {
    const { batchId } = req.params as { batchId: string };
    const result = await campaignsService.batch(batchId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  /**
   * Search customers for the composer's picker.
   *
   * Email and name only — the composer needs to find a person, not read their
   * account. Escaped, because a regex from a client is otherwise a denial of
   * service waiting to happen.
   */
  searchUsers: async (req: Request, res: Response): Promise<void> => {
    const { q } = req.query as { q?: string };
    const term = (q ?? '').trim();

    if (term.length < 2) {
      ResponseUtil.ok(res, []);
      return;
    }

    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');

    const users = await UserModel.find(
      { $or: [{ email: pattern }, { name: pattern }] },
      { email: 1, name: 1 },
    )
      .limit(20)
      .lean()
      .exec();

    ResponseUtil.ok(
      res,
      users.map((user) => ({ id: user._id, email: user.email, name: user.name })),
    );
  },

  /**
   * The composer: build a kind for named users.
   *
   * Nothing is sent — it lands as a batch in review, like any other.
   */
  compose: async (req: Request, res: Response): Promise<void> => {
    const staff = requireStaff(req);
    const body = req.body as { kind: EmailKind; user_ids: string[] };

    const result = await campaignsService.draftForUsers(
      body.kind,
      body.user_ids,
      await actingStaff(staff.staffId),
    );

    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  /** Run a sweep's drafting now, rather than waiting for its schedule. */
  draftNow: async (req: Request, res: Response): Promise<void> => {
    const { kind } = req.params as { kind: EmailKind };
    const result = await campaignsService.draftSweep(kind);
    if (!result.success) return bail(result);
    ResponseUtil.accepted(res, result.data);
  },

  editDraft: async (req: Request, res: Response): Promise<void> => {
    const staff = requireStaff(req);
    const { draftId } = req.params as { draftId: string };
    const body = req.body as { subject?: string; text?: string; html?: string };

    const result = await campaignsService.editDraft(
      draftId,
      body,
      await actingStaff(staff.staffId),
    );
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  excludeDraft: async (req: Request, res: Response): Promise<void> => {
    const staff = requireStaff(req);
    const { draftId } = req.params as { draftId: string };
    const { reason } = req.body as { reason?: string };

    const result = await campaignsService.excludeDraft(
      draftId,
      reason ?? null,
      await actingStaff(staff.staffId),
    );
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  updateSettings: async (req: Request, res: Response): Promise<void> => {
    const staff = requireStaff(req);
    const { kind } = req.params as { kind: EmailKind };

    const result = await campaignsService.updateSettings(
      kind,
      req.body as Parameters<typeof campaignsService.updateSettings>[1],
      await actingStaff(staff.staffId),
    );
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  approve: async (req: Request, res: Response): Promise<void> => {
    const staff = requireStaff(req);
    const { batchId } = req.params as { batchId: string };

    const result = await campaignsService.approve(batchId, await actingStaff(staff.staffId));
    if (!result.success) return bail(result);
    ResponseUtil.accepted(res, result.data);
  },

  discard: async (req: Request, res: Response): Promise<void> => {
    const staff = requireStaff(req);
    const { batchId } = req.params as { batchId: string };

    const result = await campaignsService.discard(batchId, await actingStaff(staff.staffId));
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },
};
