import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireStaff } from '@shared/middleware/authenticate-staff.middleware.js';

import { staffAuthService } from './staff-auth.service.js';

const originOf = (req: Request) => ({
  userAgent: req.header('user-agent') ?? null,
  ip: req.ip ?? null,
});

export const staffAuthController = {
  setupState: async (_req: Request, res: Response): Promise<void> => {
    ResponseUtil.ok(res, { needs_setup: await staffAuthService.needsBootstrap() });
  },

  bootstrap: async (_req: Request, res: Response): Promise<void> => {
    const result = await staffAuthService.bootstrap();
    if (!result.success) return bail(result);
    // The password is in this response and nowhere else. Never emailed, never
    // stored in the clear, not recoverable.
    ResponseUtil.ok(res, result.data);
  },

  login: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { email: string; password: string };
    const result = await staffAuthService.login(body, originOf(req));
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  refresh: async (req: Request, res: Response): Promise<void> => {
    const { refresh_token } = req.body as { refresh_token: string };
    const result = await staffAuthService.refresh(refresh_token, originOf(req));
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  logout: async (req: Request, res: Response): Promise<void> => {
    const { refresh_token } = req.body as { refresh_token: string };
    const result = await staffAuthService.logout(refresh_token);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  /** Who am I, for the console to render itself. */
  me: async (req: Request, res: Response): Promise<void> => {
    const staff = requireStaff(req);
    const { StaffUserModel } = await import('../staff/staff-user.model.js');
    const { expand } = await import('@shared/constants/permissions.js');
    const { ALL_SCOPES } = await import('@shared/constants/permissions.js');
    const { STAFF_TIERS } = await import('../staff/staff-user.model.js');

    const row = await StaffUserModel.findById(staff.staffId).lean().exec();
    if (row === null) {
      ResponseUtil.ok(res, null);
      return;
    }

    ResponseUtil.ok(res, {
      id: row._id,
      email: row.email,
      name: row.name,
      tier: row.tier,
      status: row.status,
      /**
       * EFFECTIVE scopes, implications resolved.
       *
       * A super admin bypasses checks rather than holding every scope, so it
       * is given the full set here — otherwise the console would hide
       * everything from the one account that can do anything.
       */
      permissions:
        row.tier === STAFF_TIERS.SUPER_ADMIN ? [...ALL_SCOPES] : expand(row.permissions),
      group_keys: row.permissionGroupKeys,
    });
  },
};
