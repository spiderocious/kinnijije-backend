import type { Request, Response } from 'express';

import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';
import { PROMPT_IDS } from '@lib/ai/index.js';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import type {
  AddStockInput,
  CreateCustomUnitInput,
  SeedStockInput,
  UpdateStockInput,
} from './stock.schema.js';
import { stockService } from './stock.service.js';

export const stockController = {
  /** Names in, stock rows out — a new account's kitchen from the decide flow. */
  seed: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { names } = req.body as SeedStockInput;
    const result = await stockService.seedFromNames(actor.userId, names);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

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
    const body = req.body as AddStockInput;
    const result = await stockService.add(actor.userId, body);
    if (!result.success) return bail(result);

    /**
     * Human acceptance is the only honest measure of extraction quality.
     *
     * The model's self-graded confidence is not evidence — what a person kept
     * after reading the suggestions is. Only for the AI-fed sources: a manual
     * add has nothing to accept or reject.
     */
    if (body.source === 'photo' || body.source === 'receipt') {
      analytics.track(SERVER_EVENTS.AI_EXTRACTION_REVIEWED, actor.userId, {
        prompt_id:
          body.source === 'photo'
            ? PROMPT_IDS.INGREDIENTS_FROM_PHOTO
            : PROMPT_IDS.INGREDIENTS_FROM_RECEIPT,
        // What the person kept. The count the model SUGGESTED is not known
        // here — the client drops rejected rows before sending — so this is
        // the numerator; `stock_added.item_count` on the client is the pair.
        accepted_count: result.data.length,
      });
    }

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
