import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import type { SaveKitchenInput } from './kitchen.schema.js';
import { kitchenService } from './kitchen.service.js';

export const kitchenController = {
  get: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await kitchenService.get(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  save: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await kitchenService.save(actor.userId, req.body as SaveKitchenInput);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },
};
