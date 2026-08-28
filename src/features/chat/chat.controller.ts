import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import type { AskInput } from './chat.schema.js';
import { chatService } from './chat.service.js';

export const chatController = {
  history: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await chatService.history(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  ask: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { question } = req.body as AskInput;
    const result = await chatService.ask(actor.userId, question);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  clear: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await chatService.clear(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },
};
