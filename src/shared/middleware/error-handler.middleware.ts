import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { IS_PRODUCTION } from '@app/env.js';
import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';
import { AppError } from '@lib/errors.js';
import { logger } from '@lib/logger/index.js';
import { ResponseUtil } from '@lib/response.js';
import { ERROR_CODES, severityFor } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { routePattern } from '@shared/utils/route-pattern.js';
import { MESSAGE_KEYS, resolveErrorMessage } from '@shared/messages/index.js';
import { fieldErrorsFromZod } from '@shared/utils/zod.js';

/**
 * The one place an error becomes a response body. Nothing else in the codebase
 * writes an error status — if it did, envelopes would drift per controller.
 *
 * Registered last in app.ts: middleware added after it never sees an error.
 */
/**
 * One event for every error the app returns.
 *
 * Fired here rather than at each throw site because this middleware is already
 * the single place an error becomes a response — so one call covers the whole
 * surface and a new throw site cannot forget to report itself.
 *
 * `route` is the Express route PATTERN (`/stock/:stockId`), never the resolved
 * url: the pattern has bounded cardinality and groups correctly in a report,
 * while the raw path would create a distinct value per id.
 */
function reportError(
  req: Request,
  errorClass: string,
  code: string,
  httpStatus: number,
  severity: number,
  rejectionReason?: string,
): void {
  analytics.track(
    SERVER_EVENTS.API_ERROR_RETURNED,
    req.actor?.userId ?? analytics.anonymousId(req.ip ?? 'unknown'),
    {
      error_code: code,
      severity,
      http_status: httpStatus,
      route: routePattern(req),
      method: req.method,
      is_authenticated: req.actor !== undefined,
      error_class: errorClass,
      ...(rejectionReason !== undefined && { rejection_reason: rejectionReason }),
    },
  );
}

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

    reportError(
      req,
      'app_error',
      err.code,
      err.httpStatus,
      severityFor(err.code),
      err.rejectionReason,
    );

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
    reportError(
      req,
      'zod',
      ERROR_CODES.VALIDATION_ERROR,
      HTTP_STATUS.UNPROCESSABLE,
      severityFor(ERROR_CODES.VALIDATION_ERROR),
    );
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
    reportError(
      req,
      'malformed_body',
      ERROR_CODES.MALFORMED_JSON,
      HTTP_STATUS.BAD_REQUEST,
      severityFor(ERROR_CODES.MALFORMED_JSON),
    );
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
  // The one count that must stay at zero. Everything else here is a client
  // mistake; this is ours.
  reportError(
    req,
    'unhandled',
    ERROR_CODES.INTERNAL,
    HTTP_STATUS.INTERNAL,
    severityFor(ERROR_CODES.INTERNAL),
  );

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
