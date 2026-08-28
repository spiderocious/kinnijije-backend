import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import type { UserRole, UserStatus } from '@shared/constants/roles.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import type {
  UpdateProfileInput,
  UpdateRoleInput,
  UpdateStatusInput,
} from './users.schema.js';
import { usersService } from './users.service.js';

export const usersController = {
  me: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await usersService.getById(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  updateMe: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await usersService.updateProfile(actor.userId, req.body as UpdateProfileInput);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  updateSettings: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await usersService.updateSettings(actor.userId, req.body as Record<string, unknown>);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  deleteMe: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await usersService.deleteAccount(actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const result = await usersService.list(req.query);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data.users, {
      next_cursor: result.data.nextCursor,
      has_more: result.data.hasMore,
    });
  },

  getOne: async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params as { userId: string };
    const result = await usersService.getById(userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  updateStatus: async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params as { userId: string };
    const { status, reason } = req.body as UpdateStatusInput;
    const result = await usersService.updateStatus(userId, status as UserStatus, reason ?? null);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  updateRole: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { userId } = req.params as { userId: string };
    const { role } = req.body as UpdateRoleInput;
    const result = await usersService.updateRole(userId, actor.userId, role as UserRole);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },
};
