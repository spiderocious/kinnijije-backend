import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 4 does not catch a rejected promise from a handler: the rejection
 * escapes as an unhandled rejection, the client hangs until timeout, and the
 * error middleware never runs. Every async handler is wrapped.
 */
export const asyncHandler =
  (fn: AsyncRouteHandler): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
