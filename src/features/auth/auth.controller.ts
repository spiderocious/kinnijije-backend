import type { Request, Response } from 'express';

import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';
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

/**
 * The domain only, never the address.
 *
 * `gmail.com` tells you which providers your users are on, which is worth
 * knowing. The full address is personal data and has no business leaving the
 * server for an analytics vendor.
 */
/** Host only — a full referrer can carry query parameters we have no business storing. */
function hostOf(referer: string | undefined): string | null {
  if (referer === undefined) return null;
  try {
    return new URL(referer).host;
  } catch {
    return null;
  }
}

function emailDomain(email: unknown): string {
  return typeof email === 'string' && email.includes('@')
    ? (email.split('@')[1]?.toLowerCase() ?? 'unknown')
    : 'unknown';
}

/** The only two things a service needs from the request — never `req` itself. */
const originOf = (req: Request): SessionOrigin => ({
  userAgent: req.header('user-agent') ?? null,
  ip: req.ip ?? null,
});

export const authController = {
  register: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as RegisterInput;
    const result = await authService.register(body, originOf(req));

    if (!result.success) {
      analytics.track(
        SERVER_EVENTS.AUTH_ATTEMPT_FAILED,
        analytics.anonymousId(req.ip ?? 'unknown'),
        { operation: 'register', error_code: result.code },
      );
      return bail(result);
    }

    // The authoritative signup count. Reconcile against the client's
    // `signed_up` and the gap is the share of browsers blocking analytics.
    analytics.track(SERVER_EVENTS.USER_REGISTERED, result.data.user.id, {
      email_domain: emailDomain(body.email),
      referrer_host: hostOf(req.header('referer')),
    });
    analytics.setProfile(result.data.user.id, {
      email: body.email,
      created_at: new Date().toISOString(),
      status: result.data.user.status,
      has_onboarded: false,
    });

    ResponseUtil.created(res, result.data);
  },

  login: async (req: Request, res: Response): Promise<void> => {
    const result = await authService.login(req.body as LoginInput, originOf(req));

    if (!result.success) {
      // The failure codes are what make this useful: the service already tells
      // `invalid_credentials` from `account_locked` from `account_banned`, and
      // those are three completely different problems.
      analytics.track(
        SERVER_EVENTS.AUTH_ATTEMPT_FAILED,
        analytics.anonymousId(req.ip ?? 'unknown'),
        { operation: 'login', error_code: result.code },
      );
      return bail(result);
    }

    // Keeps role and status current, so admin traffic and suspended accounts
    // can be excluded from product reports.
    analytics.setProfile(result.data.user.id, {
      status: result.data.user.status,
    });

    ResponseUtil.ok(res, result.data);
  },

  refresh: async (req: Request, res: Response): Promise<void> => {
    const { refresh_token } = req.body as RefreshInput;
    const result = await authService.refresh(refresh_token, originOf(req));

    if (!result.success) {
      // Silent session churn. A high rate here is people being logged out
      // mid-task, which reads as churn and is really a token bug.
      analytics.track(
        SERVER_EVENTS.TOKEN_REFRESHED,
        analytics.anonymousId(req.ip ?? 'unknown'),
        { ok: false, error_code: result.code },
      );
      return bail(result);
    }

    analytics.track(SERVER_EVENTS.TOKEN_REFRESHED, result.data.user.id, { ok: true });
    ResponseUtil.ok(res, result.data);
  },

  logout: async (req: Request, res: Response): Promise<void> => {
    const { refresh_token } = req.body as LogoutInput;
    const result = await authService.logout(refresh_token);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  requestPasswordReset: async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body as { email: string };
    // Always 204, whatever happened — the response must not reveal whether an
    // account exists.
    const result = await authService.requestPasswordReset(email, req.ip ?? null);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  resetPassword: async (req: Request, res: Response): Promise<void> => {
    const { token, new_password: newPassword } = req.body as {
      token: string;
      new_password: string;
    };
    const result = await authService.resetPassword(token, newPassword);
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
