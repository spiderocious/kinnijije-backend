import { MealModel } from '@features/meals/meals.model.js';
import { FEATURE_FLAGS, flagsService } from '@lib/flags/index.js';
import { JobModel } from '@lib/jobs/jobs.model.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import type { JobContext } from '@lib/jobs/jobs.types.js';
import { logger } from '@lib/logger/index.js';

import { chowdeckClient, type RefusalReason } from './chowdeck.client.js';
import {
  ChowdeckOfferModel,
  ChowdeckPlaceModel,
  chowdeckQuery,
  offerKey,
} from './chowdeck.model.js';
import { DEFAULT_SEED_PLACES, type SeedPlace } from './chowdeck.places-seed.js';
import { chowdeckService, FRESH_MS } from './chowdeck.service.js';

/**
 * The two things that call Chowdeck in bulk. Both are started by a person in
 * the console and NEVER on a schedule: nothing here runs unless somebody
 * asked for it.
 *
 * Both wait for outbound slots rather than being refused, so they go exactly
 * as fast as the shared per-minute limit allows and no faster — a big job
 * spreads itself out instead of spending a cook's allowance in one burst.
 */

export const PLACE_IMPORT_JOB_TYPE = 'chowdeck-place-import';
export const FETCH_AHEAD_JOB_TYPE = 'chowdeck-fetch-ahead';

/** A fetch-ahead larger than this is almost certainly a mistake. */
export const MAX_FETCH_AHEAD_PAIRS = 500;

/** These refusals will not clear by themselves within a job's lifetime. Stop rather than log 400 refusals. */
const STOPPING: readonly RefusalReason[] = ['fetch_disabled', 'daily_cap', 'breaker_open'];

// ── Place import ─────────────────────────────────────────────────────────

export interface PlaceImportPayload {
  actorId: string;
  /** Omitted means the default list. */
  places?: SeedPlace[] | undefined;
}

async function runPlaceImport(payload: unknown, ctx: JobContext): Promise<unknown> {
  const { actorId, places } = payload as PlaceImportPayload;
  const list = places ?? [...DEFAULT_SEED_PLACES];

  const saved: string[] = [];
  const existing: string[] = [];
  const notFound: string[] = [];
  const failed: { query: string; reason: string }[] = [];
  let stopped: string | null = null;

  for (const [i, seed] of list.entries()) {
    if (await ctx.isCancelled()) return { cancelled: true, saved, existing, not_found: notFound, failed };
    await ctx.setProgress(i / list.length, seed.query);

    const outcome = await chowdeckClient.autocomplete(seed.query, {
      trigger: 'job',
      actorId,
      waitForSlot: true,
      isCancelled: ctx.isCancelled,
    });

    if (outcome.refusal !== null && STOPPING.includes(outcome.refusal)) {
      stopped = outcome.refusal;
      break;
    }
    if (outcome.status !== 'ok' || outcome.data === null) {
      failed.push({ query: seed.query, reason: outcome.error ?? outcome.status });
      continue;
    }

    // A town, when they offer one: "Oyo" can also come back as the state, and
    // the state is not somewhere a rider delivers to.
    const top = outcome.data.find((p) => p.types.includes('locality')) ?? outcome.data[0];
    if (top === undefined) {
      notFound.push(seed.query);
      continue;
    }

    const name = top.structured_formatting?.main_text ?? top.description.split(',')[0] ?? top.description;

    /**
     * One chip per place. Their autocomplete often answers a small town with
     * the nearest big one — "Kubwa" and "Lugbe" both come back as Abuja — so
     * a second seed landing on the same place id, or on a name already saved
     * in the same state, is skipped rather than saved as a lookalike.
     */
    const duplicate = await ChowdeckPlaceModel.exists({
      $or: [
        { _id: top.place_id },
        { state: seed.state, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      ],
    }).exec();
    if (duplicate !== null) {
      // Kept as is: a place somebody hid or relabelled by hand stays that way.
      existing.push(`${seed.query} → ${top.description}`);
      continue;
    }

    await ChowdeckPlaceModel.create({
      _id: top.place_id,
      name,
      description: top.description,
      secondary: top.structured_formatting?.secondary_text ?? null,
      city: seed.city,
      state: seed.state,
      // The list order IS the display order: the first town of a state leads it.
      rank: i,
      types: top.types,
      active: true,
      searchedWith: seed.query,
      addedBy: actorId,
    });
    saved.push(`${seed.query} → ${top.description}`);
  }

  await ctx.setProgress(1, 'Done');
  logger.info('chowdeck place import finished', {
    saved: saved.length,
    existing: existing.length,
    not_found: notFound.length,
    failed: failed.length,
    stopped,
  });
  return { saved, existing, not_found: notFound, failed, stopped };
}

// ── Fetch ahead ──────────────────────────────────────────────────────────

export interface FetchAheadPayload {
  actorId: string;
  /** Empty means every published meal. */
  mealSlugs: string[];
  /** Empty means every active place. */
  placeIds: string[];
  /** Refetch even a fresh row. Off by default: the point is to fill gaps, not to spend calls. */
  force: boolean;
}

async function runFetchAhead(payload: unknown, ctx: JobContext): Promise<unknown> {
  const { actorId, mealSlugs, placeIds, force } = payload as FetchAheadPayload;

  const [meals, places] = await Promise.all([
    MealModel.find(
      { status: 'published', ...(mealSlugs.length > 0 && { slug: { $in: mealSlugs } }) },
      { slug: 1, name: 1 },
    )
      .lean()
      .exec(),
    ChowdeckPlaceModel.find({ active: true, ...(placeIds.length > 0 && { _id: { $in: placeIds } }) }, { _id: 1 })
      .lean()
      .exec(),
  ]);

  const pairs = places
    .flatMap((place) => meals.map((meal) => ({ placeId: place._id, meal })))
    .slice(0, MAX_FETCH_AHEAD_PAIRS);

  let fetched = 0;
  let skippedFresh = 0;
  let empty = 0;
  const failed: { place_id: string; meal: string; reason: string }[] = [];
  let stopped: string | null = null;

  for (const [i, pair] of pairs.entries()) {
    if (await ctx.isCancelled()) break;
    await ctx.setProgress(i / Math.max(1, pairs.length), `${pair.meal.name} · ${pair.placeId}`);

    // Same normalisation as the user path, or the two would warm and read
    // different cache keys for the same meal.
    const query = chowdeckQuery(pair.meal.name);
    if (!force) {
      const row = await ChowdeckOfferModel.findOne({ key: offerKey(pair.placeId, query) }, { fetchedAt: 1 })
        .lean()
        .exec();
      if (row !== null && Date.now() - row.fetchedAt.getTime() < FRESH_MS) {
        skippedFresh += 1;
        continue;
      }
    }

    const result = await chowdeckService.refresh(pair.placeId, query, pair.meal.slug, {
      trigger: 'job',
      actorId,
      waitForSlot: true,
      isCancelled: ctx.isCancelled,
    });

    if (result.outcome.refusal !== null && STOPPING.includes(result.outcome.refusal)) {
      stopped = result.outcome.refusal;
      break;
    }
    if (result.row === null) {
      failed.push({ place_id: pair.placeId, meal: pair.meal.slug, reason: result.outcome.error ?? result.outcome.status });
      continue;
    }
    fetched += 1;
    if (result.row.status === 'empty') empty += 1;
  }

  await ctx.setProgress(1, 'Done');
  return {
    pairs: pairs.length,
    fetched,
    empty,
    skipped_fresh: skippedFresh,
    failed,
    stopped,
    cancelled: await ctx.isCancelled(),
  };
}

// ── First-run bootstrap ──────────────────────────────────────────────────

/** How long after any import (automatic or by hand) before another automatic one is allowed. */
const AUTO_IMPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
let autoImportChecked = false;

/**
 * Imports the default places ONCE, the first time a cook searches places and
 * the table is empty.
 *
 * Without it, switching Chowdeck on did nothing visible: no saved places meant
 * no place could be picked, which meant no offers were ever asked for — and
 * every part of that failed quietly by design. The console import still
 * exists; this only covers "nobody has run it yet".
 *
 * Guarded three ways so it cannot become traffic: the fetch flag must be on,
 * the table must be empty, and no import of any kind may have been queued in
 * the last day — so an import that found nothing (Chowdeck refusing us, say)
 * is not retried on every keystroke.
 */
export async function ensurePlacesSeeded(): Promise<void> {
  if (autoImportChecked) return;

  try {
    if (!(await flagsService.isOn(FEATURE_FLAGS.CHOWDECK_FETCH))) return;
    // Only now is the answer settled for this process: with the flag on, one
    // check decides it, and later searches skip straight past.
    autoImportChecked = true;

    if ((await ChowdeckPlaceModel.estimatedDocumentCount().exec()) > 0) return;

    const recent = await JobModel.exists({
      type: PLACE_IMPORT_JOB_TYPE,
      createdAt: { $gte: new Date(Date.now() - AUTO_IMPORT_COOLDOWN_MS) },
    }).exec();
    if (recent !== null) return;

    const payload: PlaceImportPayload = { actorId: 'system' };
    await jobQueue.enqueue({ type: PLACE_IMPORT_JOB_TYPE, ownerId: 'system', payload, maxAttempts: 1 });
    logger.info('chowdeck places empty — default import queued automatically', {
      count: DEFAULT_SEED_PLACES.length,
    });
  } catch (error) {
    // Allow a later search to try again; a failed check must not stick.
    autoImportChecked = false;
    logger.warn('chowdeck automatic place import could not be queued', {
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

export function registerChowdeckHandlers(): void {
  jobQueue.register(PLACE_IMPORT_JOB_TYPE, runPlaceImport);
  jobQueue.register(FETCH_AHEAD_JOB_TYPE, runFetchAhead);
}
