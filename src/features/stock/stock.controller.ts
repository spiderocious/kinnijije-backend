import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import type { AddStockInput, CreateCustomUnitInput, UpdateStockInput } from './stock.schema.js';
import { stockService } from './stock.service.js';

export const stockController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await stockService.list(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  dashboard: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    // `could_make` needs the suggestion engine; passed in so the stock service
    // stays ignorant of meals.
    const { mealsService } = await import('@features/meals/meals.service.js');
    const count = await mealsService.countMakeable(actor.userId);
    const result = await stockService.dashboard(actor.userId, count);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  // Not async: this reads the in-memory catalogue and touches no database.
  suggest: (req: Request, res: Response): void => {
    // Already coerced and validated by SuggestQuerySchema on the route.
    const { q, limit } = req.query as unknown as { q: string; limit?: number };
    const result = stockService.suggestIngredients(q, limit ?? 8);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  add: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await stockService.add(actor.userId, req.body as AddStockInput);
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  getOne: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { stockId } = req.params as { stockId: string };
    const result = await stockService.getOne(stockId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { stockId } = req.params as { stockId: string };
    const result = await stockService.update(stockId, actor.userId, req.body as UpdateStockInput);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { stockId } = req.params as { stockId: string };
    const result = await stockService.remove(stockId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  history: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await stockService.history(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  listUnits: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await stockService.listCustomUnits(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  createUnit: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await stockService.createCustomUnit(actor.userId, req.body as CreateCustomUnitInput);
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  deleteUnit: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { unitId } = req.params as { unitId: string };
    const result = await stockService.deleteCustomUnit(unitId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },
};
