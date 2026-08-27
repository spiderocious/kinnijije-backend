import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import type { ChangePasswordInput, LoginInput, LogoutInput, RefreshInput, RegisterInput } from './auth.schema.js';
import { authService, type SessionOrigin } from './auth.service.js';

/**
 * Thin by design: read the request, call the service, map the result. A
 * controller that branches on *why* something failed has taken on business
 * logic that belongs in the service.
 */

/** The only two things a service needs from the request — never `req` itself. */
const originOf = (req: Request): SessionOrigin => ({
  userAgent: req.header('user-agent') ?? null,
  ip: req.ip ?? null,
});

export const authController = {
  register: async (req: Request, res: Response): Promise<void> => {
    const result = await authService.register(req.body as RegisterInput, originOf(req));
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  login: async (req: Request, res: Response): Promise<void> => {
    const result = await authService.login(req.body as LoginInput, originOf(req));
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  refresh: async (req: Request, res: Response): Promise<void> => {
    const { refresh_token } = req.body as RefreshInput;
    const result = await authService.refresh(refresh_token, originOf(req));
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  logout: async (req: Request, res: Response): Promise<void> => {
    const { refresh_token } = req.body as LogoutInput;
    const result = await authService.logout(refresh_token);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  changePassword: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await authService.changePassword(actor.userId, req.body as ChangePasswordInput);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },
};
