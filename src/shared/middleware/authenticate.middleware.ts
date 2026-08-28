import type { NextFunction, Request, Response } from 'express';

import { AppError } from '@lib/errors.js';
import { requestContext } from '@lib/http/request-context.js';
import { verifyAccessToken } from '@lib/tokens.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { SESSION_ALLOWED_STATUSES, type UserRole, type UserStatus } from '@shared/constants/roles.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

export interface AuthenticatedActor {
  userId: string;
  role: UserRole;
  status: UserStatus;
  sessionId: string;
}

// The Request.actor augmentation lives in src/types/express.d.ts — an
// augmentation inside this file cannot resolve the module to augment.

const BEARER = 'Bearer ';

/**
 * Verifies the access token and puts the actor on the request AND into the
 * request context — the context is what services read, so they never touch
 * `req`.
 *
 * This answers only "who is this?". Whether they may act is `requireRole` and
 * `requireStatus`, deliberately separate: conflating identity with permission
 * is how an endpoint ends up checking one and forgetting the other.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');

  /**
   * EventSource cannot set headers, so an SSE stream has no way to send a
   * bearer token except in the query string. Accepted ONLY for the stream
   * route — a token in a URL lands in server logs and browser history, so it
   * is deliberately not a general fallback.
   */
  const isStream = req.path.endsWith('/stream');
  const queryToken = isStream ? (req.query['token'] as string | undefined) : undefined;

  if ((header === undefined || !header.startsWith(BEARER)) && queryToken === undefined) {
    next(
      new AppError(
        ERROR_CODES.UNAUTHENTICATED,
        HTTP_STATUS.UNAUTHORIZED,
        'missing bearer token',
        MESSAGE_KEYS.auth.UNAUTHENTICATED,
        undefined,
        'missing_authorization_header',
      ),
    );
    return;
  }

  const raw = header?.startsWith(BEARER) === true ? header.slice(BEARER.length).trim() : (queryToken ?? '');
  const result = verifyAccessToken(raw);

  if (!result.valid) {
    const expired = result.reason === 'expired';
    next(
      new AppError(
        expired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID,
        HTTP_STATUS.UNAUTHORIZED,
        `access token ${result.reason}`,
        expired ? MESSAGE_KEYS.auth.TOKEN_EXPIRED : MESSAGE_KEYS.auth.TOKEN_INVALID,
        undefined,
        `token_${result.reason}`,
      ),
    );
    return;
  }

  const { sub, role, status, sid } = result.claims;

  // A token minted before a ban is cryptographically valid but must not act.
  // Checked here so every authenticated route inherits it without opting in.
  if (!SESSION_ALLOWED_STATUSES.includes(status)) {
    next(
      new AppError(
        status === 'banned' ? ERROR_CODES.ACCOUNT_BANNED : ERROR_CODES.ACCOUNT_DELETED,
        HTTP_STATUS.FORBIDDEN,
        `token presented by ${status} account`,
        status === 'banned'
          ? MESSAGE_KEYS.access.ACCOUNT_BANNED
          : MESSAGE_KEYS.access.ACCOUNT_DELETED,
        undefined,
        `status_${status}`,
      ),
    );
    return;
  }

  req.actor = { userId: sub, role, status, sessionId: sid };

  const context = requestContext.getStore();
  if (context !== undefined) {
    context.user_id = sub;
    context.role = role;
    context.status = status;
    context.session_id = sid;
  }

  next();
}

/**
 * Reads the actor a preceding `authenticate` established. Throwing rather than
 * returning undefined is deliberate: reaching this without `authenticate` in
 * front is a wiring bug, and it should fail loudly in development rather than
 * silently treating the request as anonymous.
 */
export function requireActor(req: Request): AuthenticatedActor {
  const { actor } = req;
  if (actor === undefined) {
    throw new AppError(
      ERROR_CODES.UNAUTHENTICATED,
      HTTP_STATUS.UNAUTHORIZED,
      'requireActor called without authenticate middleware',
      MESSAGE_KEYS.auth.UNAUTHENTICATED,
      undefined,
      'missing_authenticate_middleware',
    );
  }
  return actor;
}
