import type { Request, Response } from 'express';

import { UserModel } from '@features/users/users.model.js';
import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import { scriptsService } from './scripts.service.js';

export const scriptsController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    const result = await scriptsService.list();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  run: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { scriptId } = req.params as { scriptId: string };
    const { dry_run } = req.body as { dry_run?: boolean };

    // The email is read here so the audit row survives the account: a job runs
    // on the worker, long after this request, and may outlive the person.
    const row = await UserModel.findById(actor.userId, { email: 1 }).lean().exec();

    const result = await scriptsService.run(scriptId, dry_run ?? false, {
      id: actor.userId,
      email: row?.email ?? 'unknown',
      role: actor.role,
    });

    if (!result.success) return bail(result);
    // 202: queued, not finished. The job screen follows it from here.
    ResponseUtil.accepted(res, result.data);
  },
};
