import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import type { AddMarketItemInput, ToggleBoughtInput } from './market.schema.js';
import { marketService } from './market.service.js';

export const marketController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await marketService.list(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  add: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await marketService.add(actor.userId, req.body as AddMarketItemInput);
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  setBought: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { marketId } = req.params as { marketId: string };
    const { bought } = req.body as ToggleBoughtInput;
    const result = await marketService.setBought(marketId, actor.userId, bought);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { marketId } = req.params as { marketId: string };
    const result = await marketService.remove(marketId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  clearBought: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await marketService.clearBought(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },
};
