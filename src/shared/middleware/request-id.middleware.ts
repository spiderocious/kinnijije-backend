import type { NextFunction, Request, Response } from 'express';
import { ulid } from 'ulidx';

import { requestContext, type RequestContext } from '@lib/http/request-context.js';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Seeds AsyncLocalStorage for the rest of the request and echoes the id back,
 * so a client-reported failure can be found in the logs by that id alone.
 *
 * Must run before anything that logs — everything downstream reads the store.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming !== undefined && incoming.length > 0 ? incoming : `req_${ulid()}`;

  res.setHeader(REQUEST_ID_HEADER, requestId);

  const context: RequestContext = {
    request_id: requestId,
    method: req.method,
    path: req.originalUrl,
  };

  requestContext.run(context, () => {
    next();
  });
}
