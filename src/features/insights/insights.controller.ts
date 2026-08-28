import type { Request, Response } from 'express';

import { jobQueue } from '@lib/jobs/jobs.queue.js';
import { toJobView } from '@lib/jobs/jobs.types.js';
import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import { INSIGHT_JOB_TYPE } from './insights.jobs.js';
import { insightsService } from './insights.service.js';

export const insightsController = {
  /**
   * The week. Numbers are computed in code and returned immediately; the AI
   * reading comes from cache if it is fresh.
   */
  week: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await insightsService.weekSummary(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  /**
   * Asks for a fresh reading.
   *
   * Returns the existing job id rather than queueing a second one when nothing
   * has changed — otherwise opening the screen twice pays twice.
   */
  refreshReading: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);

    const needed = await insightsService.needsRecompute(actor.userId);
    if (!needed) {
      ResponseUtil.ok(res, { queued: false, reason: 'Nothing has changed since the last reading.' });
      return;
    }

    const job = await jobQueue.enqueue({
      type: INSIGHT_JOB_TYPE,
      ownerId: actor.userId,
      payload: { ownerId: actor.userId },
    });

    ResponseUtil.accepted(res, { queued: true, job: toJobView(job) });
  },
};
