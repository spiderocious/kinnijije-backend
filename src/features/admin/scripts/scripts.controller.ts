import type { Request, Response } from 'express';

import { StaffUserModel } from '../staff/staff-user.model.js';
import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireStaff } from '@shared/middleware/authenticate-staff.middleware.js';

import { scriptsService } from './scripts.service.js';

export const scriptsController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    const result = await scriptsService.list();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  run: async (req: Request, res: Response): Promise<void> => {
    const actor = requireStaff(req);
    const { scriptId } = req.params as { scriptId: string };
    const { dry_run } = req.body as { dry_run?: boolean };

    // Captured here so the audit row survives the account: a job runs on the
    // worker long after this request, and may outlive the person.
    const row = await StaffUserModel.findById(actor.staffId, { email: 1, tier: 1 })
      .lean()
      .exec();

    const result = await scriptsService.run(
      scriptId,
      dry_run ?? false,
      { id: actor.staffId, email: row?.email ?? actor.email, role: row?.tier ?? actor.tier },
      'run',
    );

    if (!result.success) return bail(result);
    // 202: queued, not finished. The job screen follows it from here.
    ResponseUtil.accepted(res, result.data);
  },

  /**
   * Undo the last real run.
   *
   * Only reaches a script that declared a `revert`; the service refuses the
   * rest rather than pretending to undo something it cannot.
   */
  revert: async (req: Request, res: Response): Promise<void> => {
    const actor = requireStaff(req);
    const { scriptId } = req.params as { scriptId: string };

    const row = await StaffUserModel.findById(actor.staffId, { email: 1, tier: 1 })
      .lean()
      .exec();

    const result = await scriptsService.run(
      scriptId,
      false,
      { id: actor.staffId, email: row?.email ?? actor.email, role: row?.tier ?? actor.tier },
      'revert',
    );

    if (!result.success) return bail(result);
    ResponseUtil.accepted(res, result.data);
  },
};
