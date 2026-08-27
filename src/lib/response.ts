import type { Response } from 'express';

import { HTTP_STATUS } from '@shared/constants/http-status.js';
import type { ApiErrorBody, ApiMeta } from '@shared/types/envelope.types.js';

/**
 * The only sanctioned way to write a response body. `res.json()` in a handler
 * is always a bug: it bypasses the envelope, and it bypasses the one place
 * whole-body concerns belong.
 *
 * Whole-body concerns handled here so no callsite has to remember them:
 *   - bigint serialisation (JSON.stringify throws on bigint outright)
 *   - undefined-valued keys stripped, so `exactOptionalPropertyTypes` objects
 *     do not emit `"key": null` for an absent optional
 */
export class ResponseUtil {
  static ok<T>(res: Response, data: T, meta?: ApiMeta): Response {
    return res
      .status(HTTP_STATUS.OK)
      .json(serialise(meta === undefined ? { data } : { data, meta }));
  }

  static created<T>(res: Response, data: T): Response {
    return res.status(HTTP_STATUS.CREATED).json(serialise({ data }));
  }

  static accepted<T>(res: Response, data?: T): Response {
    return res.status(HTTP_STATUS.ACCEPTED).json(serialise(data === undefined ? {} : { data }));
  }

  /** 204 carries no body at all — calling .json() on it is a client-side parse error. */
  static noContent(res: Response): Response {
    return res.status(HTTP_STATUS.NO_CONTENT).end();
  }

  static error(res: Response, status: number, error: ApiErrorBody): Response {
    return res.status(status).json(serialise({ error }));
  }
}

/**
 * One walk of the body, in one file, instead of remembering at every callsite.
 * `JSON.stringify` throws a TypeError on bigint, so it is converted here: a
 * number while it fits in the safe-integer range, a string beyond it, where a
 * JSON number would silently lose digits.
 */
function serialise(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }

  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialise);

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      out[key] = serialise(item);
    }
    return out;
  }

  return value;
}
