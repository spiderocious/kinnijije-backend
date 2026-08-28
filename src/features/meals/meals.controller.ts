import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import { mealsService } from './meals.service.js';

export const mealsController = {
  suggest: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await mealsService.suggest(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const result = await mealsService.list(req.query);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  favourites: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await mealsService.listFavourites(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  detail: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { mealId } = req.params as { mealId: string };
    const result = await mealsService.detail(mealId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  /**
   * Materialise a meal the assistant invented, by name.
   *
   * Returns the id of the meal we now have — either one that already existed
   * under that name, or one just written and saved.
   */
  generate: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { name } = req.body as { name: string };
    const result = await mealsService.generateFromName(name, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  favourite: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { mealId } = req.params as { mealId: string };
    const result = await mealsService.favourite(mealId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  unfavourite: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { mealId } = req.params as { mealId: string };
    const result = await mealsService.unfavourite(mealId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  cooked: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { mealId } = req.params as { mealId: string };
    const result = await mealsService.markCooked(mealId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },
};
