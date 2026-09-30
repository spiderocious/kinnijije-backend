import { record } from '@lib/audit/index.js';
import { logger } from '@lib/logger/index.js';
import { isoOrNull } from '@lib/dates.js';

import {
  FAIL_CLOSED_FLAGS,
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

/**
 * The default state: everything on EXCEPT the fail-closed flags.
 *
 * This is the answer when no row exists and when the database is down, so the
 * one function carries both defaults — an ordinary flag ships enabled without
 * a migration, an analytics flag ships disabled until somebody turns it on.
 */
function defaults(): FlagState {
  const out = {} as FlagState;
  for (const key of Object.values(FEATURE_FLAGS)) {
    out[key] = !FAIL_CLOSED_FLAGS.includes(key);
  }
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
   * FAILS OPEN for ordinary flags: if they cannot be read, everything is on —
   * a database blip must not silently strip features out of the product, and a
   * flag system that fails closed takes the whole app down with it.
   *
   * FAILS CLOSED for the analytics pair. See `FAIL_CLOSED_FLAGS`.
   */
  async state(): Promise<FlagState> {
    if (cache !== null && cache.expires > Date.now()) return cache.value;

    const value = defaults();
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

  /**
   * The cached answer, or `undefined` if nothing has been read yet.
   *
   * Exists for the analytics service, which is called from request paths and
   * from `catch` blocks where awaiting a flag is not acceptable — an await
   * there would add latency to every request and could reorder a log line
   * against the error it describes.
   *
   * `undefined` means "not known yet", which an analytics caller must treat as
   * off. It is deliberately NOT collapsed into `false` here: a caller that
   * wants to distinguish "off" from "unknown" still can.
   */
  cached(key: FeatureFlag): boolean | undefined {
    if (cache === null || cache.expires <= Date.now()) return undefined;
    return cache.value[key];
  }

  /**
   * Fills the cache. Called once at boot so the first request does not have to
   * decide analytics policy from an empty cache.
   */
  async warm(): Promise<void> {
    await this.state();
  }

  /** Every flag with its label and who last touched it, for the console. */
  async listForConsole(): Promise<
    { key: string; label: string; when_on: string; when_off: string; enabled: boolean; updated_by: string | null; reason: string | null; updated_at: string | null }[]
  > {
    const rows = await FlagModel.find().exec();
    const byKey = new Map(rows.map((row) => [row._id, row]));
    const live = await this.state();

    return FLAG_DEFINITIONS.map((definition) => {
      const row = byKey.get(definition.key);
      return {
        key: definition.key,
        label: definition.label,
        when_on: definition.whenOn,
        when_off: definition.whenOff,
        /**
         * The RUNTIME answer, not a guess from the row.
         *
         * `row?.enabled !== false` showed a flag with no row as on, which is
         * true for an ordinary flag and false for a fail-closed one — so a
         * never-touched tour or invite read "on" in the console while being
         * off in the product. The console must show what is actually
         * happening, or it is worse than no console.
         */
        enabled: live[definition.key],
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
    record({
      action: 'flags.changed',
      resource: 'flags',
      resourceId: key,
      changes: [{ field: 'enabled', from: !enabled, to: enabled }],
      meta: reason === undefined ? null : { reason },
    });
  }
}

export const flagsService = FlagsService.getInstance();
