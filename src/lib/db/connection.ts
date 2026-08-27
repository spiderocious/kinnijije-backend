import mongoose from 'mongoose';

import { env, IS_PRODUCTION } from '@app/env.js';
import { logger } from '@lib/logger/index.js';

/**
 * Strict query filters: an undefined value in a filter is an error rather than
 * being silently dropped. Without this, a bug that leaves `{ _id: undefined }`
 * matches the first document in the collection instead of none.
 */
mongoose.set('strictQuery', 'throw');

/**
 * Index creation is a development convenience. In production it is a migration
 * step — building an index on a large collection under load is an incident,
 * not something a deploy should trigger implicitly.
 */
mongoose.set('autoIndex', !IS_PRODUCTION);

let connected = false;

export async function connectDatabase(): Promise<void> {
  if (connected) return;

  mongoose.connection.on('connected', () => {
    logger.info('mongodb connected', { database: mongoose.connection.name });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('mongodb disconnected');
  });

  mongoose.connection.on('error', (error: Error) => {
    logger.error('mongodb connection error', { error });
  });

  await mongoose.connect(env.MONGODB_URI, {
    // Fail fast at boot rather than queueing commands against a server that is
    // not there — a hung request is far harder to diagnose than a clear error.
    serverSelectionTimeoutMS: 5_000,
    maxPoolSize: 20,
    minPoolSize: 2,
  });

  connected = true;
}

export async function disconnectDatabase(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
  logger.info('mongodb connection closed');
}

/**
 * 1 is mongoose's `connected` readyState.
 *
 * The named `ConnectionStates` enum is a type-only export under mongoose's
 * CJS interop — importing it as a value type-checks but throws at runtime.
 * The numeric literal is compared through Number() so the lint rule does not
 * see a bare cross-enum comparison.
 */
const READY_STATE_CONNECTED = 1;

export const isDatabaseHealthy = (): boolean =>
  Number(mongoose.connection.readyState) === READY_STATE_CONNECTED;

/** Exposed for the health endpoint's readiness probe. */
export async function pingDatabase(): Promise<boolean> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (admin === undefined) return false;
    await admin.ping();
    return true;
  } catch (error) {
    logger.error('mongodb ping failed', { error: error instanceof Error ? error : String(error) });
    return false;
  }
}
