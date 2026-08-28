import type { Request, Response } from 'express';
import { z } from 'zod';

import { jobQueue } from '@lib/jobs/jobs.queue.js';
import { toJobView } from '@lib/jobs/jobs.types.js';
import { ResponseUtil } from '@lib/response.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import { JOB_TYPES } from './extraction.jobs.js';

/** Five is the cap: more photos than that is a scanning session, not a shelf. */
export const StartExtractionSchema = z.object({
  file_ids: z.array(z.string().min(1)).min(1, 'Add at least one photo').max(5, 'Five photos at a time'),
});

export const extractionController = {
  /**
   * Queues the cheap validity check and answers IMMEDIATELY with a job id.
   * The interface then polls or streams — it never waits on the model here.
   */
  checkPhotos: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { file_ids } = req.body as { file_ids: string[] };

    const job = await jobQueue.enqueue({
      type: JOB_TYPES.PHOTO_CHECK,
      ownerId: actor.userId,
      payload: { fileIds: file_ids, ownerId: actor.userId },
    });

    ResponseUtil.accepted(res, toJobView(job));
  },

  extractPhotos: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { file_ids } = req.body as { file_ids: string[] };

    const job = await jobQueue.enqueue({
      type: JOB_TYPES.PHOTO_EXTRACT,
      ownerId: actor.userId,
      payload: { fileIds: file_ids, ownerId: actor.userId },
    });

    ResponseUtil.accepted(res, toJobView(job));
  },

  extractReceipt: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { file_ids } = req.body as { file_ids: string[] };

    const job = await jobQueue.enqueue({
      type: JOB_TYPES.RECEIPT_EXTRACT,
      ownerId: actor.userId,
      payload: { fileIds: file_ids, ownerId: actor.userId },
    });

    ResponseUtil.accepted(res, toJobView(job));
  },
};
