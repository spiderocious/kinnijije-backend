import { logger } from '@lib/logger/index.js';
import { isoOrNull } from '@lib/dates.js';

import {
  FEATURE_FLAGS,
  FLAG_DEFINITIONS,
  FlagModel,
  type FeatureFlag,
} from './flags.model.js';

/** What the app is told: every flag, and whether it is on. */
export type FlagState = Record<FeatureFlag, boolean>;

/**
 * Feature flags, read constantly and written almost never.
 *
 * Cached for thirty seconds. Every consumer page load asks for these, and a
 * database round trip per load to answer "is the tour on" is waste — but the
 * window is short enough that switching something off in the console takes
 * effect while the operator is still looking at the screen.
 */
const CACHE_MS = 30_000;
let cache: { value: FlagState; expires: number } | null = null;

/** Everything on. The answer when no row exists, and when the database is down. */
function allOn(): FlagState {
  const out = {} as FlagState;
  for (const key of Object.values(FEATURE_FLAGS)) out[key] = true;
  return out;
}

export class FlagsService {
  private static instance: FlagsService | undefined;

  static getInstance(): FlagsService {
    FlagsService.instance ??= new FlagsService();
    return FlagsService.instance;
  }

  /**
   * The current state of every flag.
   *
   * FAILS OPEN. If the flags cannot be read, everything is on — a database
   * blip must not silently strip features out of the product, and a flag
   * system that fails closed takes the whole app down with it.
   */
  async state(): Promise<FlagState> {
    if (cache !== null && cache.expires > Date.now()) return cache.value;

    const value = allOn();
    try {
      const rows = await FlagModel.find().exec();
      for (const row of rows) value[row._id] = row.enabled;
    } catch (error) {
      logger.error('could not read feature flags — assuming everything is on', {
        error: error instanceof Error ? error : String(error),
      });
      return value;
    }

    cache = { value, expires: Date.now() + CACHE_MS };
    return value;
  }

  /** Whether one flag is on. */
  async isOn(key: FeatureFlag): Promise<boolean> {
    return (await this.state())[key];
  }

  /** Every flag with its label and who last touched it, for the console. */
  async listForConsole(): Promise<
    { key: string; label: string; when_off: string; enabled: boolean; updated_by: string | null; reason: string | null; updated_at: string | null }[]
  > {
    const rows = await FlagModel.find().exec();
    const byKey = new Map(rows.map((row) => [row._id, row]));

    return FLAG_DEFINITIONS.map((definition) => {
      const row = byKey.get(definition.key);
      return {
        key: definition.key,
        label: definition.label,
        when_off: definition.whenOff,
        enabled: row?.enabled !== false,
        updated_by: row?.updatedBy ?? null,
        reason: row?.reason ?? null,
        updated_at: isoOrNull(row?.updatedAt),
      };
    });
  }

  async set(
    key: FeatureFlag,
    enabled: boolean,
    actorId: string,
    reason?: string,
  ): Promise<void> {
    await FlagModel.findByIdAndUpdate(
      key,
      { $set: { enabled, updatedBy: actorId, reason: reason ?? null } },
      { upsert: true },
    ).exec();

    // Dropped rather than updated: the next read rebuilds it from the database,
    // which is the only copy that is definitely right.
    cache = null;

    logger.info('feature flag switched', { flag: key, enabled, by: actorId, reason });
  }
}

export const flagsService = FlagsService.getInstance();
