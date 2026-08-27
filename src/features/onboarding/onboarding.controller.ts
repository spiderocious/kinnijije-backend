import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import type { SaveOnboardingInput } from './onboarding.schema.js';
import { onboardingService } from './onboarding.service.js';

export const onboardingController = {
  get: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await onboardingService.get(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  save: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await onboardingService.save(actor.userId, req.body as SaveOnboardingInput);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  complete: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await onboardingService.complete(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },
};
