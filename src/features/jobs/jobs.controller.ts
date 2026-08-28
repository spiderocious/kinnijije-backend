import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import { jobsService } from './jobs.service.js';
import { streamJob } from './jobs.sse.js';

export const jobsController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await jobsService.list(actor.userId, req.query);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  get: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { jobId } = req.params as { jobId: string };
    const result = await jobsService.get(jobId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  cancel: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { jobId } = req.params as { jobId: string };
    const result = await jobsService.cancel(jobId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  retry: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { jobId } = req.params as { jobId: string };
    const result = await jobsService.retry(jobId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  // Writes its own response: SSE is a long-lived stream, not an envelope.
  stream: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    await streamJob(req, res, actor.userId);
  },
};
