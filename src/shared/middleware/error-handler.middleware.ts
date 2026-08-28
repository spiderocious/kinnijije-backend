import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { IS_PRODUCTION } from '@app/env.js';
import { AppError } from '@lib/errors.js';
import { logger } from '@lib/logger/index.js';
import { ResponseUtil } from '@lib/response.js';
import { ERROR_CODES, severityFor } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS, resolveErrorMessage } from '@shared/messages/index.js';
import { fieldErrorsFromZod } from '@shared/utils/zod.js';

/**
 * The one place an error becomes a response body. Nothing else in the codebase
 * writes an error status — if it did, envelopes would drift per controller.
 *
 * Registered last in app.ts: middleware added after it never sees an error.
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Headers already flushed — the response is committed, so hand off to
  // Express's default handler to destroy the socket.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    logger.warn('handled application error', {
      code: err.code,
      status: err.httpStatus,
      internal_message: err.message,
      rejection_reason: err.rejectionReason,
    });

    if (err.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
    }

    ResponseUtil.error(res, err.httpStatus, {
      code: err.code,
      // A specific reason beats the registry default — see AppError.
      message: err.overrideMessage ?? resolveErrorMessage(err.code, err.messageKey),
      severity: severityFor(err.code),
      ...(err.fieldErrors !== undefined && { field_errors: err.fieldErrors }),
      ...(err.rejectionReason !== undefined && { rejection_reason: err.rejectionReason }),
    });
    return;
  }

  // A Zod failure that reaches here escaped a validation middleware — still a
  // client error, so it must not inflate the 5xx rate.
  if (err instanceof ZodError) {
    logger.warn('unhandled zod error at boundary', { issues: err.issues });
    ResponseUtil.error(res, HTTP_STATUS.UNPROCESSABLE, {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: resolveErrorMessage(ERROR_CODES.VALIDATION_ERROR),
      severity: severityFor(ERROR_CODES.VALIDATION_ERROR),
      field_errors: fieldErrorsFromZod(err),
    });
    return;
  }

  // express.json() throws a SyntaxError on an unparseable body. Left to fall
  // through, it renders as a 500 and inflates the error-rate alarm for what is
  // squarely a client mistake.
  if (isBodyParseError(err)) {
    logger.warn('malformed request body', { path: req.originalUrl });
    ResponseUtil.error(res, HTTP_STATUS.BAD_REQUEST, {
      code: ERROR_CODES.MALFORMED_JSON,
      message: resolveErrorMessage(ERROR_CODES.MALFORMED_JSON, MESSAGE_KEYS.common.MALFORMED_JSON),
      severity: severityFor(ERROR_CODES.MALFORMED_JSON),
    });
    return;
  }

  logger.error('unhandled error', {
    error: err instanceof Error ? err : String(err),
    path: req.originalUrl,
  });

  ResponseUtil.error(res, HTTP_STATUS.INTERNAL, {
    code: ERROR_CODES.INTERNAL,
    message: resolveErrorMessage(ERROR_CODES.INTERNAL),
    severity: severityFor(ERROR_CODES.INTERNAL),
    // Internals never leak to a client in production; in development the
    // real message saves a trip to the logs.
    ...(!IS_PRODUCTION &&
      err instanceof Error && { rejection_reason: err.message }),
  });
};

function isBodyParseError(err: unknown): boolean {
  return (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status?: number }).status === HTTP_STATUS.BAD_REQUEST &&
    'body' in err
  );
}

/** Terminal 404 for an unmatched path. Registered just before the handler above. */
export function notFoundHandler(_req: Request, res: Response): void {
  ResponseUtil.error(res, HTTP_STATUS.NOT_FOUND, {
    code: ERROR_CODES.NOT_FOUND,
    message: resolveErrorMessage(ERROR_CODES.NOT_FOUND),
    severity: severityFor(ERROR_CODES.NOT_FOUND),
  });
}
