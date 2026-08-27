import { Router, type Express } from 'express';

import { isDatabaseHealthy, pingDatabase } from '@lib/db/connection.js';
import { ResponseUtil } from '@lib/response.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { ERROR_CODES, severityFor } from '@shared/constants/error-codes.js';
import { MESSAGE_KEYS, messages, resolveErrorMessage } from '@shared/messages/index.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';

const router = Router();

const startedAt = Date.now();

/**
 * Liveness: is the process up? Deliberately checks nothing external — a
 * liveness probe that fails when the database is down gets the container
 * killed and restarted, which does not fix a database and does lose in-flight
 * requests.
 */
router.get('/health', (_req, res) => {
  ResponseUtil.ok(res, {
    status: 'ok',
    message: messages.get(MESSAGE_KEYS.common.HEALTHY),
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    database: isDatabaseHealthy() ? 'connected' : 'disconnected',
  });
});

/**
 * Readiness: should this instance receive traffic? This one DOES check the
 * database, because an instance that cannot reach it can serve nothing useful
 * and should be pulled from the load balancer.
 */
router.get(
  '/health/ready',
  asyncHandler(async (_req, res) => {
    const databaseUp = await pingDatabase();

    if (!databaseUp) {
      res.setHeader('Retry-After', '5');
      ResponseUtil.error(res, HTTP_STATUS.UNAVAILABLE, {
        code: ERROR_CODES.UPSTREAM_FAILURE,
        message: resolveErrorMessage(ERROR_CODES.UPSTREAM_FAILURE),
        severity: severityFor(ERROR_CODES.UPSTREAM_FAILURE),
        rejection_reason: 'database_unreachable',
      });
      return;
    }

    ResponseUtil.ok(res, { status: 'ready', database: 'connected' });
  }),
);

export function register(app: Express): void {
  // Unversioned on purpose: probes are infrastructure, not API surface, and
  // must not move when the API version does.
  app.use('/', router);
}
