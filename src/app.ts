import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { env } from '@app/env.js';
import { register as registerAdmin } from '@features/admin/index.js';
import { register as registerAuth } from '@features/auth/index.js';
import { register as registerExtraction } from '@features/extraction/index.js';
import { register as registerFiles } from '@features/files/index.js';
import { register as registerHealth } from '@features/health/index.js';
import { register as registerChat } from '@features/chat/index.js';
import { register as registerConfig } from '@features/config/index.js';
import { register as registerInsights } from '@features/insights/index.js';
import { register as registerJobs } from '@features/jobs/index.js';
import { register as registerMarket } from '@features/market/index.js';
import { register as registerMeals } from '@features/meals/index.js';
import { register as registerStock } from '@features/stock/index.js';
import { register as registerKitchen } from '@features/kitchen/index.js';
import { register as registerOnboarding } from '@features/onboarding/index.js';
import { register as registerUsers } from '@features/users/index.js';
import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { logger } from '@lib/logger/index.js';
import { errorHandler, notFoundHandler } from '@shared/middleware/error-handler.middleware.js';
import { httpLoggerMiddleware } from '@shared/middleware/http-logger.middleware.js';
import { byIp, rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { requestIdMiddleware } from '@shared/middleware/request-id.middleware.js';

/**
 * Builds the configured app without listening. Kept separate from server.ts so
 * the app can be mounted directly by a test harness rather than bound to a port.
 *
 * MIDDLEWARE ORDER IS LOAD-BEARING throughout this function. Each step below
 * says what depends on it.
 */
export function buildApp(): Express {
  const app = express();

  // Behind a proxy (Railway, Fly, an ALB) req.ip is the proxy's address unless
  // X-Forwarded-For is trusted — which would make every IP-keyed rate limit
  // one shared bucket. `1` trusts exactly one hop, not an arbitrary chain a
  // client could forge.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      // Echoed back so a browser will let the client read its own request id.
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    }),
  );

  // Before any handler that reads req.body — including the logger below.
  // The cap stops a large body from being buffered before anything rejects it.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Seeds AsyncLocalStorage. Must precede everything that logs, since every
  // log line stamps the request id from the store.
  app.use(requestIdMiddleware);

  // After request-id (so its lines carry one) and after express.json (so it
  // can log the parsed body).
  app.use(httpLoggerMiddleware);

  // The global backstop, keyed by IP and applied before any route runs, so a
  // flood is refused before it reaches a handler or the database. Per-route
  // policies layer on top of this.
  app.use(rateLimit(RATE_LIMITS.GLOBAL, byIp));

  // Probes first: they must answer even when something below is unhealthy.
  registerHealth(app);
  registerConfig(app);

  // Feature registration order. Both mount under /api/v1 with non-overlapping
  // path prefixes (/auth/* and /users/*), so the order between them is not
  // load-bearing today — but order WITHIN users.routes.ts is. See the comment
  // there before reordering anything.
  registerAuth(app);
  registerUsers(app);
  registerFiles(app);
  registerOnboarding(app);
  registerKitchen(app);
  registerJobs(app);
  registerStock(app);
  registerMeals(app);
  registerMarket(app);
  registerExtraction(app);
  registerChat(app);
  registerInsights(app);
  // Last of the features: every path here is under /admin, so it cannot shadow
  // a consumer route however it is ordered.
  registerAdmin(app);

  // Unmatched path → a 404 in the standard envelope, not Express's HTML page.
  app.use(notFoundHandler);

  // Last, always. Middleware registered after this never sees an error.
  app.use(errorHandler);

  logger.debug('application built', { cors_origins: env.CORS_ORIGINS });

  return app;
}
