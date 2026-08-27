import winston from 'winston';

import { env, IS_PRODUCTION } from '@app/env.js';
import { currentRequestId } from '@lib/http/request-context.js';

import { redact } from './redact.js';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

/**
 * Stamps every line with the current request id, pulled from AsyncLocalStorage
 * rather than threaded through call signatures. A log line you cannot tie back
 * to a request is nearly useless during an incident.
 */
const withRequestId = winston.format((info) => {
  info.request_id ??= currentRequestId();
  return info;
});

/**
 * Applied to the whole line, so a nested password is caught wherever it sits.
 *
 * The info object is mutated in place rather than rebuilt. Winston carries its
 * level and message on symbol keys (`Symbol(level)`, `Symbol(message)`) that a
 * spread silently drops — and colorize() then throws on the missing level.
 */
const RESERVED = new Set(['level', 'message', 'timestamp', 'stack']);

const withRedaction = winston.format((info) => {
  const subject: Record<string, unknown> = {};
  for (const key of Object.keys(info)) {
    if (!RESERVED.has(key)) subject[key] = info[key];
  }

  const cleaned = redact(subject) as Record<string, unknown>;

  for (const key of Object.keys(subject)) delete info[key];
  Object.assign(info, cleaned);

  return info;
});

/** Human-readable in development; structured JSON wherever logs get shipped. */
const developmentFormat = printf(({ level, message, timestamp: ts, request_id, ...rest }) => {
  const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  return `${String(ts)} ${level} [${String(request_id)}] ${String(message)}${meta}`;
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    errors({ stack: true }),
    timestamp(),
    withRequestId(),
    withRedaction(),
    IS_PRODUCTION ? json() : combine(colorize({ level: true }), developmentFormat),
  ),
  transports: [new winston.transports.Console()],
  // Let the process crash on a genuinely unexpected fault rather than limping
  // on in an unknown state; the platform restarts it.
  exitOnError: false,
});

export type Logger = typeof logger;
