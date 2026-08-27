import { ERROR_CODES, type ErrorCode } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import type { MessageKey } from '@shared/messages/keys.js';

/**
 * Thrown at the HTTP boundary only. The global error middleware is the single
 * place that renders it into the envelope.
 *
 * `message` (inherited from Error) is the INTERNAL message — it goes to logs
 * and stack traces and must never be served to a client. The client-facing
 * text is resolved from `messageKey` through the message registry.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    internalMessage: string,
    readonly messageKey?: MessageKey,
    readonly fieldErrors?: Record<string, string[]>,
    /** Diagnostic only. Never contract — no client may branch on it. */
    readonly rejectionReason?: string,
    /** Seconds, for the Retry-After header on 429. */
    readonly retryAfterSeconds?: number,
  ) {
    super(internalMessage);
    this.name = 'AppError';
  }
}

export const notFound = (what: string): AppError =>
  new AppError(ERROR_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND, `${what} not found`);

export const unauthenticated = (why: string): AppError =>
  new AppError(ERROR_CODES.UNAUTHENTICATED, HTTP_STATUS.UNAUTHORIZED, why, undefined, undefined, why);
