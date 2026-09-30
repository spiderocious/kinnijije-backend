import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';
import { AppError } from '@lib/errors.js';
import { getContext } from '@lib/http/request-context.js';
import { logger } from '@lib/logger/index.js';
import { rateLimitStore, type RateLimitPolicy } from '@lib/ratelimit/index.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { routePattern } from '@shared/utils/route-pattern.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

/**
 * Derives the bucket key. Authenticated traffic is keyed by user id so a user
 * behind a shared NAT is not punished for their neighbours; anonymous traffic
 * falls back to IP.
 */
export type KeyResolver = (req: Request) => string;

const byIdentity: KeyResolver = (req) => {
  const userId = getContext()?.user_id;
  return userId !== undefined ? `user:${userId}` : `ip:${req.ip ?? 'unknown'}`;
};

export const byIp: KeyResolver = (req) => `ip:${req.ip ?? 'unknown'}`;

/** For login: a per-email bucket, so one attacker cannot lock out via IP rotation alone. */
export const byBodyField =
  (field: string): KeyResolver =>
  (req) => {
    const body: unknown = req.body;
    const value =
      body !== null && typeof body === 'object' && field in body
        ? (body as Record<string, unknown>)[field]
        : undefined;
    // A missing field falls back to IP, tagged as such: mixing a bare `ip:`
    // key into a field-scoped bucket would silently share a bucket with a
    // different limiter that keys the same way.
    return typeof value === 'string'
      ? `${field}:${value.toLowerCase()}`
      : `${field}-missing-ip:${req.ip ?? 'unknown'}`;
  };

/**
 * Refusals per bucket in the current hour, for telling tuning from attack.
 *
 * A real person hits the decide cap once and either waits or signs up. Fifty
 * refusals from one bucket in an hour is a script. In memory and bounded —
 * this is a signal, not an audit trail, and it resets on restart like the
 * limiter's own buckets do.
 */
const refusals = new Map<string, { count: number; hourStartedAt: number }>();
const HOUR_MS = 60 * 60 * 1000;
/** Past this many refusals in one hour, the bucket is reported as abuse. */
const ABUSE_THRESHOLD = 20;
/** Bounds the map so a distributed flood cannot grow it without limit. */
const MAX_TRACKED_BUCKETS = 10_000;

function countRefusal(key: string): number {
  const now = Date.now();
  const existing = refusals.get(key);

  if (existing === undefined || now - existing.hourStartedAt > HOUR_MS) {
    if (refusals.size >= MAX_TRACKED_BUCKETS) refusals.clear();
    refusals.set(key, { count: 1, hourStartedAt: now });
    return 1;
  }

  existing.count += 1;
  return existing.count;
}

/**
 * Applies one policy. Always sets the X-RateLimit-* headers, on allow and on
 * deny alike, so a well-behaved client can pace itself before being refused.
 *
 * On refusal, `Retry-After` carries the real wait: "try again later" gives a
 * client nothing to compute a backoff from, so it hammers the endpoint.
 */
export const rateLimit = (
  policy: RateLimitPolicy,
  resolveKey: KeyResolver = byIdentity,
  /**
   * Distinguishes two limiters that share a policy. Login applies the same
   * policy twice — once per IP, once per email — and without a scope both
   * would compute the same key and drain ONE bucket at twice the rate, so the
   * limit fired at half its stated value.
   */
  scope = '',
): RequestHandler => {
  const handler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `${policy.name}:${scope}:${resolveKey(req)}`;
    const decision = await rateLimitStore.consume(key, policy.capacity, policy.refillPerSec);

    res.setHeader('X-RateLimit-Limit', String(policy.capacity));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, decision.remaining)));
    res.setHeader('X-RateLimit-Reset', String(decision.resetAtEpochSeconds));

    if (!decision.allowed) {
      logger.warn('rate limit exceeded', {
        policy: policy.name,
        path: req.originalUrl,
        retry_after_seconds: decision.retryAfterSeconds,
      });

      const isAuthenticated = getContext()?.user_id !== undefined;
      const distinctId = getContext()?.user_id ?? analytics.anonymousId(req.ip ?? 'unknown');

      analytics.track(SERVER_EVENTS.RATE_LIMIT_EXCEEDED, distinctId, {
        policy: policy.name,
        route: routePattern(req),
        // Which bucket refused, not the bucket's value — the key itself holds
        // an email or an IP and must never leave the server.
        key_kind: scope !== '' ? scope : 'identity',
        is_authenticated: isAuthenticated,
        retry_after_seconds: decision.retryAfterSeconds,
      });

      const refusalCount = countRefusal(key);
      if (refusalCount === ABUSE_THRESHOLD) {
        // Fired once, on crossing — not on every refusal after it, which would
        // bury the signal in the noise it is meant to surface.
        analytics.track(SERVER_EVENTS.ANONYMOUS_ABUSE_SUSPECTED, distinctId, {
          route: routePattern(req),
          policy: policy.name,
          refusals_in_window: refusalCount,
          is_authenticated: isAuthenticated,
        });
      }

      next(
        new AppError(
          ERROR_CODES.RATE_LIMITED,
          HTTP_STATUS.TOO_MANY_REQUESTS,
          `rate limit exceeded for policy ${policy.name}`,
          MESSAGE_KEYS.common.RATE_LIMITED,
          undefined,
          `policy_${policy.name}`,
          decision.retryAfterSeconds,
        ),
      );
      return;
    }

    next();
  };

  // Not asyncHandler: that helper is for route handlers, and this is
  // middleware — but the rejection still has to reach the error middleware.
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
};
