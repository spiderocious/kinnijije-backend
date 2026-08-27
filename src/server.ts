import type { Server } from 'node:http';

import { buildApp } from '@app/app.js';
import { env, IS_PRODUCTION } from '@app/env.js';
import { connectDatabase, disconnectDatabase } from '@lib/db/connection.js';
import { logger } from '@lib/logger/index.js';
import { assertMailerConfigured } from '@lib/mail/mailer.js';
import { stopRateLimitStore } from '@lib/ratelimit/index.js';

/**
 * Production-only requirements live here rather than in the env schema, so
 * development can boot without production secrets while production still fails
 * loudly instead of degrading silently.
 */
function assertProductionReadiness(): void {
  if (!IS_PRODUCTION) return;

  assertMailerConfigured();

  if (env.JWT_ACCESS_SECRET.includes('dev-only') || env.JWT_REFRESH_SECRET.includes('dev-only')) {
    throw new Error('Refusing to start: JWT secrets are still the development defaults');
  }

  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error('Refusing to start: access and refresh secrets must differ');
  }
}

async function main(): Promise<void> {
  assertProductionReadiness();

  // The database connects before the port opens: an instance that accepts
  // traffic it cannot serve fails every request instead of failing to start.
  await connectDatabase();

  const app = buildApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info('server listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      base_url: `http://localhost:${env.PORT}/api/v1`,
    });
  });

  installShutdownHandlers(server);
}

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests
 * finish, then close the database. Killing the process outright drops
 * requests that were one line from completing.
 */
function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('shutdown signal received', { signal });

    // A connection that never finishes must not hold the process open forever.
    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close((error) => {
      if (error !== undefined) {
        logger.error('error while closing http server', { error });
      }

      void (async () => {
        stopRateLimitStore();
        await disconnectDatabase();
        logger.info('shutdown complete');
        clearTimeout(forceExit);
        process.exit(0);
      })();
    });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  // The process state is unknown after either of these. Log, then let it die
  // and be restarted rather than serving from a corrupted state.
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { error });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', {
      error: reason instanceof Error ? reason : String(reason),
    });
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  logger.error('failed to start server', {
    error: error instanceof Error ? error : String(error),
  });
  process.exit(1);
});
