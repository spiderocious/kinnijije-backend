import type { NextFunction, Request, Response } from 'express';

import { IS_PRODUCTION } from '@app/env.js';
import { getContext } from '@lib/http/request-context.js';
import { logger } from '@lib/logger/index.js';

/**
 * Bodies are capped before they reach the logger. An unbounded body — a large
 * upload, a long list response — turns a log line into a memory and cost
 * problem, and nobody reads past the first few hundred characters anyway.
 */
const MAX_LOGGED_BODY_CHARS = 2_000;

/** Noise: they fire constantly and a healthy one says nothing worth storing. */
const QUIET_PATHS = new Set(['/health', '/health/live', '/health/ready', '/favicon.ico']);

const cap = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  const serialised = JSON.stringify(value);
  if (serialised === undefined) return undefined;
  if (serialised.length <= MAX_LOGGED_BODY_CHARS) return value;
  return `${serialised.slice(0, MAX_LOGGED_BODY_CHARS)}…[truncated ${serialised.length} chars]`;
};

/**
 * Logs one line when a request arrives and one when it finishes, carrying the
 * request body and the response body. Redaction happens inside the logger, so
 * a password in either direction never lands in a sink.
 *
 * Response bodies are captured by wrapping `res.json` — the single funnel every
 * response passes through, since ResponseUtil is the only thing that writes one.
 */
export function httpLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (QUIET_PATHS.has(req.path)) {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();

  logger.http('→ request', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    user_agent: req.header('user-agent'),
    body: cap(req.body),
  });

  const originalJson = res.json.bind(res);
  let responseBody: unknown;

  res.json = (body: unknown): Response => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const context = getContext();

    // A response body is worth keeping when something went wrong. On a
    // successful production response it is bulk with little diagnostic value.
    const includeBody = !IS_PRODUCTION || res.statusCode >= 400;

    const payload = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Number(durationMs.toFixed(2)),
      user_id: context?.user_id,
      role: context?.role,
      ...(includeBody && { body: cap(responseBody) }),
    };

    if (res.statusCode >= 500) logger.error('← response', payload);
    else if (res.statusCode >= 400) logger.warn('← response', payload);
    else logger.http('← response', payload);
  });

  next();
}
