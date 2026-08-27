import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import type { RequestUploadInput } from './files.schema.js';
import { filesService } from './files.service.js';

export const filesController = {
  requestUpload: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await filesService.requestUpload(actor.userId, req.body as RequestUploadInput);
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  confirmUpload: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { fileId } = req.params as { fileId: string };
    const result = await filesService.confirmUpload(fileId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  getOne: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { fileId } = req.params as { fileId: string };
    const result = await filesService.getOne(fileId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await filesService.list(actor.userId, req.query);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data.files, {
      next_cursor: result.data.nextCursor,
      has_more: result.data.hasMore,
    });
  },
};
