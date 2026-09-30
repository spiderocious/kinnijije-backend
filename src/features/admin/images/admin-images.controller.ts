import type { Request, Response } from 'express';

import { composeImagePrompt } from '@features/meals/meals.image-prompt.js';
import { MealModel } from '@features/meals/meals.model.js';
import { RECIPE_IMAGE_JOB_TYPE, type RecipeImagePayload } from '@features/meals/meals.jobs.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';
import { AppError } from '@lib/errors.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import { adminImagesService } from './admin-images.service.js';

const params = (req: Request) => req.params as { mealId: string; imageId: string };

export const adminImagesController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const result = await adminImagesService.list(params(req).mealId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  requestUpload: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const body = req.body as { content_type: string; content_length: number };
    const result = await adminImagesService.requestUpload(params(req).mealId, body, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  confirmUpload: async (req: Request, res: Response): Promise<void> => {
    const { mealId, imageId } = params(req);
    const body = req.body as { content_type: string };
    const result = await adminImagesService.confirmUpload(mealId, imageId, body.content_type);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  /**
   * The prompt, without generating anything.
   *
   * This is the "take it to Gemini yourself" path: an operator copies it, runs
   * it wherever they like, cleans the background locally, and uploads the
   * finished PNG through the ordinary upload route. Costs nothing and needs no
   * key configured.
   */
  prompt: async (req: Request, res: Response): Promise<void> => {
    const meal = await MealModel.findById(params(req).mealId).exec();
    if (meal === null) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        'recipe not found',
        MESSAGE_KEYS.meals.NOT_FOUND,
      );
    }
    ResponseUtil.ok(res, { prompt: composeImagePrompt(meal), meal_name: meal.name });
  },

  /**
   * Queues a generation.
   *
   * Returns a job id immediately rather than waiting: an image model takes
   * 5-20 seconds and a console request must not hold a connection open for it.
   * The console follows the job over the SSE stream jobs.sse.ts already serves.
   */
  generate: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { mealId } = params(req);
    const body = req.body as { prompt_override?: string };

    const meal = await MealModel.findById(mealId).exec();
    if (meal === null) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        'recipe not found',
        MESSAGE_KEYS.meals.NOT_FOUND,
      );
    }

    const payload: RecipeImagePayload = {
      mealId,
      actorId: actor.userId,
      ...(body.prompt_override !== undefined && { promptOverride: body.prompt_override }),
    };

    const job = await jobQueue.enqueue({
      type: RECIPE_IMAGE_JOB_TYPE,
      ownerId: actor.userId,
      payload,
    });

    // `_id` is the string id the rest of the system uses; `id` is Mongoose's
    // loosely-typed virtual.
    ResponseUtil.accepted(res, { job_id: job._id });
  },

  publish: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { mealId, imageId } = params(req);
    const result = await adminImagesService.publish(mealId, imageId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  reject: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { mealId, imageId } = params(req);
    const body = req.body as { reason: string };
    const result = await adminImagesService.reject(mealId, imageId, body.reason, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  setPrimary: async (req: Request, res: Response): Promise<void> => {
    const { mealId } = params(req);
    const body = req.body as { image_id: string };
    const result = await adminImagesService.setPrimary(mealId, body.image_id);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const { mealId, imageId } = params(req);
    const result = await adminImagesService.remove(mealId, imageId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },
};
