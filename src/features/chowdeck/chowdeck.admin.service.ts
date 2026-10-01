import { env } from '@app/env.js';
import { MealModel } from '@features/meals/meals.model.js';
import { isoOrNull } from '@lib/dates.js';
import { FEATURE_FLAGS, flagsService } from '@lib/flags/index.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import { chowdeckClient, type CallOutcome } from './chowdeck.client.js';
import {
  FETCH_AHEAD_JOB_TYPE,
  MAX_FETCH_AHEAD_PAIRS,
  PLACE_IMPORT_JOB_TYPE,
  type FetchAheadPayload,
  type PlaceImportPayload,
} from './chowdeck.jobs.js';
import {
  ChowdeckCallModel,
  ChowdeckClickModel,
  ChowdeckOfferModel,
  ChowdeckPlaceModel,
  chowdeckQuery,
  CALL_LOG_TTL_DAYS,
  type ChowdeckCallAttributes,
  type ChowdeckOfferAttributes,
} from './chowdeck.model.js';
import { rankOffers, storeUrl } from './chowdeck.offers.js';
import { DEFAULT_SEED_PLACES } from './chowdeck.places-seed.js';
import {
  chowdeckService,
  EMPTY_FRESH_MS,
  FRESH_MS,
  servedCounters,
  STALE_MAX_MS,
} from './chowdeck.service.js';

/**
 * The console's view of Chowdeck: what we asked, what came back, what we
 * kept, and the controls to change any of it.
 */

const notFound = () => fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND);

const DAY_MS = 24 * 60 * 60 * 1000;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? null;
}

/** What a cache row is, right now: fresh, stale, or past it. */
function freshness(row: Pick<ChowdeckOfferAttributes, 'status' | 'fetchedAt'>): 'fresh' | 'stale' | 'expired' {
  const age = Date.now() - row.fetchedAt.getTime();
  const fresh = row.status === 'empty' ? EMPTY_FRESH_MS : FRESH_MS;
  if (age < fresh) return 'fresh';
  if (row.status === 'ok' && age < STALE_MAX_MS) return 'stale';
  return 'expired';
}

function callSummary(row: ChowdeckCallAttributes) {
  return {
    id: row._id,
    kind: row.kind,
    trigger: row.trigger,
    actor_id: row.actorId,
    url: row.url,
    params: row.params,
    status: row.status,
    http_status: row.httpStatus,
    duration_ms: row.durationMs,
    result_count: row.resultCount,
    error: row.error,
    // Older rows predate these fields.
    error_code: row.errorCode ?? null,
    retry_after: row.responseHeaders?.['retry-after'] ?? null,
    response_bytes: row.responseBytes,
    truncated: row.truncated,
    replay_of: row.replayOf,
    request_id: row.requestId,
    created_at: isoOrNull(row.createdAt),
  };
}

function outcomeView(outcome: CallOutcome<unknown>) {
  return {
    call_id: outcome.callId,
    status: outcome.status,
    http_status: outcome.httpStatus,
    duration_ms: outcome.durationMs,
    error: outcome.error,
    refusal: outcome.refusal,
  };
}

export class ChowdeckAdminService {
  private static instance: ChowdeckAdminService | undefined;

  static getInstance(): ChowdeckAdminService {
    ChowdeckAdminService.instance ??= new ChowdeckAdminService();
    return ChowdeckAdminService.instance;
  }

  // ── Overview ───────────────────────────────────────────────────────────

  async overview(): Promise<ServiceResult<unknown>> {
    const since = new Date(Date.now() - DAY_MS);
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);

    const [
      guards,
      offersOn,
      placesTotal,
      placesActive,
      cacheByStatus,
      callsByStatus,
      callsByTrigger,
      durations,
      recentFailures,
      clicksTotal,
      clicksByMeal,
      clicksByVendor,
      clicksByPlace,
      clicksByMode,
    ] = await Promise.all([
      chowdeckClient.state(),
      flagsService.isOn(FEATURE_FLAGS.CHOWDECK_OFFERS),
      ChowdeckPlaceModel.countDocuments().exec(),
      ChowdeckPlaceModel.countDocuments({ active: true }).exec(),
      ChowdeckOfferModel.aggregate<{ _id: string; count: number; hits: number }>([
        { $group: { _id: '$status', count: { $sum: 1 }, hits: { $sum: '$hits' } } },
      ]).exec(),
      ChowdeckCallModel.aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]).exec(),
      ChowdeckCallModel.aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: since }, status: { $ne: 'refused' } } },
        { $group: { _id: '$trigger', count: { $sum: 1 } } },
      ]).exec(),
      // Bounded by the daily cap, so this is never more than a few thousand numbers.
      ChowdeckCallModel.find({ createdAt: { $gte: since }, status: { $ne: 'refused' } }, { durationMs: 1 })
        .lean()
        .exec(),
      ChowdeckCallModel.find({ status: { $nin: ['ok', 'refused'] } })
        .select('-responseBody')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
        .exec(),
      ChowdeckClickModel.countDocuments({ createdAt: { $gte: weekAgo } }).exec(),
      this.topClicks('$mealSlug', weekAgo),
      this.topClicks('$vendorName', weekAgo),
      this.topClicks('$placeId', weekAgo),
      this.topClicks('$mode', weekAgo),
    ]);

    const sorted = durations.map((d) => d.durationMs).sort((a, b) => a - b);
    const toMap = (rows: { _id: string | null; count: number }[]) =>
      Object.fromEntries(rows.map((r) => [r._id ?? 'unknown', r.count]));

    return ok({
      flags: { offers: offersOn, fetch: guards.fetch_enabled },
      guards,
      settings: {
        fresh_hours: FRESH_MS / 3_600_000,
        stale_max_hours: STALE_MAX_MS / 3_600_000,
        empty_fresh_hours: EMPTY_FRESH_MS / 3_600_000,
        call_log_ttl_days: CALL_LOG_TTL_DAYS,
        api_base: env.CHOWDECK_API_BASE,
        web_base: env.CHOWDECK_WEB_BASE,
      },
      places: { total: placesTotal, active: placesActive },
      cache: {
        entries: cacheByStatus.reduce((sum, r) => sum + r.count, 0),
        by_status: toMap(cacheByStatus),
        hits: cacheByStatus.reduce((sum, r) => sum + r.hits, 0),
      },
      served: servedCounters(),
      calls_24h: {
        total: callsByStatus.reduce((sum, r) => sum + r.count, 0),
        by_status: toMap(callsByStatus),
        by_trigger: toMap(callsByTrigger),
        p50_ms: percentile(sorted, 50),
        p95_ms: percentile(sorted, 95),
      },
      recent_failures: recentFailures.map(callSummary),
      clicks_7d: {
        total: clicksTotal,
        by_meal: clicksByMeal,
        by_vendor: clicksByVendor,
        by_place: clicksByPlace,
        by_mode: clicksByMode,
      },
    });
  }

  private topClicks(field: string, since: Date): Promise<{ key: string | null; count: number }[]> {
    return ChowdeckClickModel.aggregate<{ key: string | null; count: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: field, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, key: '$_id', count: 1 } },
    ]).exec();
  }

  resetBreaker(actorId: string): ServiceResult<null> {
    chowdeckClient.resetBreaker(actorId);
    return ok(null);
  }

  // ── Places ─────────────────────────────────────────────────────────────

  async listPlaces(): Promise<ServiceResult<unknown>> {
    const [places, cacheCounts] = await Promise.all([
      ChowdeckPlaceModel.find().sort({ rank: 1, state: 1, name: 1 }).lean().exec(),
      ChowdeckOfferModel.aggregate<{ _id: string; count: number; ok: number }>([
        {
          $group: {
            _id: '$placeId',
            count: { $sum: 1 },
            ok: { $sum: { $cond: [{ $eq: ['$status', 'ok'] }, 1, 0] } },
          },
        },
      ]).exec(),
    ]);
    const counts = new Map(cacheCounts.map((c) => [c._id, c]));

    return ok({
      items: places.map((p) => ({
        id: p._id,
        name: p.name,
        description: p.description,
        secondary: p.secondary,
        city: p.city,
        state: p.state ?? null,
        rank: p.rank,
        types: p.types,
        active: p.active,
        searched_with: p.searchedWith,
        added_by: p.addedBy,
        cached_searches: counts.get(p._id)?.count ?? 0,
        cached_with_results: counts.get(p._id)?.ok ?? 0,
        created_at: isoOrNull(p.createdAt),
      })),
      total: places.length,
      seed_list_size: DEFAULT_SEED_PLACES.length,
    });
  }

  /** A live autocomplete, for the console to choose from. Nothing is saved. */
  async autocomplete(input: string, actorId: string): Promise<ServiceResult<unknown>> {
    const outcome = await chowdeckClient.autocomplete(input, { trigger: 'admin', actorId });
    const predictions = outcome.data ?? [];
    const saved = await ChowdeckPlaceModel.find(
      { _id: { $in: predictions.map((p) => p.place_id) } },
      { _id: 1 },
    )
      .lean()
      .exec();
    const savedIds = new Set(saved.map((s) => s._id));

    return ok({
      call: outcomeView(outcome),
      predictions: predictions.map((p) => ({
        place_id: p.place_id,
        description: p.description,
        main_text: p.structured_formatting?.main_text ?? p.description,
        secondary_text: p.structured_formatting?.secondary_text ?? null,
        types: p.types,
        saved: savedIds.has(p.place_id),
      })),
    });
  }

  async savePlace(
    input: {
      place_id: string;
      description: string;
      main_text: string;
      secondary_text?: string | null | undefined;
      types?: string[] | undefined;
      city?: string | null | undefined;
      searched_with?: string | null | undefined;
    },
    actorId: string,
  ): Promise<ServiceResult<{ id: string }>> {
    await ChowdeckPlaceModel.updateOne(
      { _id: input.place_id },
      {
        $set: {
          name: input.main_text,
          description: input.description,
          secondary: input.secondary_text ?? null,
          types: input.types ?? [],
          city: input.city ?? null,
          searchedWith: input.searched_with ?? null,
        },
        $setOnInsert: { active: true, addedBy: actorId },
      },
      { upsert: true },
    ).exec();
    logger.info('chowdeck place saved', { place_id: input.place_id, by: actorId });
    return ok({ id: input.place_id });
  }

  async updatePlace(
    placeId: string,
    input: { active?: boolean | undefined; city?: string | null | undefined; name?: string | undefined },
  ): Promise<ServiceResult<null>> {
    const set: Record<string, unknown> = {};
    if (input.active !== undefined) set['active'] = input.active;
    if (input.city !== undefined) set['city'] = input.city;
    if (input.name !== undefined) set['name'] = input.name;

    const result = await ChowdeckPlaceModel.updateOne({ _id: placeId }, { $set: set }).exec();
    if (result.matchedCount === 0) return notFound();
    return ok(null);
  }

  async deletePlace(placeId: string, actorId: string): Promise<ServiceResult<{ cleared: number }>> {
    const result = await ChowdeckPlaceModel.deleteOne({ _id: placeId }).exec();
    if (result.deletedCount === 0) return notFound();
    // Its searches go with it: nothing can reach them once the place is gone.
    const cleared = await ChowdeckOfferModel.deleteMany({ placeId }).exec();
    logger.info('chowdeck place deleted', { place_id: placeId, cleared: cleared.deletedCount, by: actorId });
    return ok({ cleared: cleared.deletedCount });
  }

  /**
   * Deletes EVERY saved place, and every cached search that belonged to them.
   *
   * For starting the list over — after changing the default list, or when an
   * import went wrong. The cache has to go with them: its rows are keyed by
   * place id, and nothing could ever reach them again.
   *
   * Cooks lose "I'll order" and the area picker until places exist again;
   * the app falls back to the plain city field meanwhile.
   */
  /**
   * Deletes the chosen places, and the cached searches that belonged to them.
   * The console's multi-select. Ids that no longer exist are simply skipped.
   */
  async deletePlaces(ids: string[], actorId: string): Promise<ServiceResult<{ places: number; cleared: number }>> {
    const [places, cache] = await Promise.all([
      ChowdeckPlaceModel.deleteMany({ _id: { $in: ids } }).exec(),
      ChowdeckOfferModel.deleteMany({ placeId: { $in: ids } }).exec(),
    ]);
    logger.info('chowdeck places deleted in bulk', {
      requested: ids.length,
      places: places.deletedCount,
      cleared: cache.deletedCount,
      by: actorId,
    });
    return ok({ places: places.deletedCount, cleared: cache.deletedCount });
  }

  async purgePlaces(actorId: string): Promise<ServiceResult<{ places: number; cleared: number }>> {
    const [places, cache] = await Promise.all([
      ChowdeckPlaceModel.deleteMany({}).exec(),
      ChowdeckOfferModel.deleteMany({}).exec(),
    ]);
    logger.warn('chowdeck places purged', {
      places: places.deletedCount,
      cleared: cache.deletedCount,
      by: actorId,
    });
    return ok({ places: places.deletedCount, cleared: cache.deletedCount });
  }

  async importPlaces(
    input: { places?: { query: string; city: string; state?: string | undefined }[] | undefined },
    actorId: string,
  ): Promise<ServiceResult<{ job_id: string; count: number }>> {
    const payload: PlaceImportPayload = {
      actorId,
      places: input.places?.map((p) => ({ query: p.query, city: p.city, state: p.state ?? p.city })),
    };
    // One attempt: a retry would re-spend every call the first run already made.
    const job = await jobQueue.enqueue({ type: PLACE_IMPORT_JOB_TYPE, ownerId: actorId, payload, maxAttempts: 1 });
    return ok({ job_id: job._id, count: input.places?.length ?? DEFAULT_SEED_PLACES.length });
  }

  // ── Cache ──────────────────────────────────────────────────────────────

  async listCache(query: {
    place_id?: string | undefined;
    q?: string | undefined;
    status?: 'ok' | 'empty' | undefined;
    freshness?: 'fresh' | 'stale' | 'expired' | undefined;
    limit?: number | undefined;
    skip?: number | undefined;
  }): Promise<ServiceResult<unknown>> {
    const filter: Record<string, unknown> = {};
    if (query.place_id !== undefined) filter['placeId'] = query.place_id;
    if (query.status !== undefined) filter['status'] = query.status;
    if (query.q !== undefined && query.q.trim().length > 0) {
      const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
      filter['$or'] = [{ query: pattern }, { mealSlug: pattern }];
    }
    if (query.freshness !== undefined) {
      const now = Date.now();
      // Expressed as time windows so the filter runs in the database.
      if (query.freshness === 'fresh') {
        filter['$expr'] = {
          $gt: [
            '$fetchedAt',
            {
              $cond: [
                { $eq: ['$status', 'empty'] },
                new Date(now - EMPTY_FRESH_MS),
                new Date(now - FRESH_MS),
              ],
            },
          ],
        };
      } else if (query.freshness === 'stale') {
        filter['status'] = 'ok';
        filter['fetchedAt'] = { $lte: new Date(now - FRESH_MS), $gt: new Date(now - STALE_MAX_MS) };
      } else {
        filter['$expr'] = {
          $lte: [
            '$fetchedAt',
            {
              $cond: [
                { $eq: ['$status', 'empty'] },
                new Date(now - EMPTY_FRESH_MS),
                new Date(now - STALE_MAX_MS),
              ],
            },
          ],
        };
      }
    }

    const limit = Math.min(query.limit ?? 50, 200);
    const [rows, total, places] = await Promise.all([
      ChowdeckOfferModel.find(filter)
        .select('-vendors.products -vendors.hours')
        .sort({ fetchedAt: -1 })
        .skip(query.skip ?? 0)
        .limit(limit)
        .lean()
        .exec(),
      ChowdeckOfferModel.countDocuments(filter).exec(),
      ChowdeckPlaceModel.find({}, { name: 1 }).lean().exec(),
    ]);
    const placeNames = new Map(places.map((p) => [p._id, p.name]));

    return ok({
      items: rows.map((row) => ({
        id: row._id,
        key: row.key,
        place_id: row.placeId,
        place_name: placeNames.get(row.placeId) ?? null,
        query: row.query,
        meal_slug: row.mealSlug,
        status: row.status,
        freshness: freshness(row),
        vendor_count: row.vendors.length,
        raw_vendor_count: row.rawVendorCount,
        dropped_vendor_count: row.droppedVendorCount,
        hits: row.hits,
        last_served_at: isoOrNull(row.lastServedAt),
        fetched_at: isoOrNull(row.fetchedAt),
        call_id: row.callId,
      })),
      total,
    });
  }

  /** One row, in full, plus exactly what a cook would see from it right now. */
  async cacheDetail(id: string): Promise<ServiceResult<unknown>> {
    const row = await ChowdeckOfferModel.findById(id).lean().exec();
    if (row === null) return notFound();
    const place = await ChowdeckPlaceModel.findById(row.placeId, { name: 1 }).lean().exec();

    return ok({
      id: row._id,
      key: row.key,
      place_id: row.placeId,
      place_name: place?.name ?? null,
      query: row.query,
      meal_slug: row.mealSlug,
      status: row.status,
      freshness: freshness(row),
      raw_vendor_count: row.rawVendorCount,
      dropped_vendor_count: row.droppedVendorCount,
      hits: row.hits,
      last_served_at: isoOrNull(row.lastServedAt),
      fetched_at: isoOrNull(row.fetchedAt),
      call_id: row.callId,
      vendors: row.vendors.map((v) => ({ ...v, store_url: storeUrl(env.CHOWDECK_WEB_BASE, v) })),
      as_served_now: rankOffers(row.vendors, new Date(), env.CHOWDECK_WEB_BASE),
    });
  }

  /** Refetch one row now, on a person's say-so. Goes through every guard like anything else. */
  async refreshCache(id: string, actorId: string): Promise<ServiceResult<unknown>> {
    const row = await ChowdeckOfferModel.findById(id, { placeId: 1, query: 1, mealSlug: 1 }).lean().exec();
    if (row === null) return notFound();
    const result = await chowdeckService.refresh(row.placeId, row.query, row.mealSlug, { trigger: 'admin', actorId });
    return ok({ call: outcomeView(result.outcome), updated: result.row !== null });
  }

  /**
   * Clears cached searches.
   *
   *   entry — one row
   *   place — every search for one place
   *   query — every place's search for one query (a meal's name)
   *   all   — everything
   *
   * Clearing is always safe: the next cook to ask simply causes one fetch.
   */
  async clearCache(
    input: { scope: 'entry' | 'place' | 'query' | 'all'; id?: string | undefined },
    actorId: string,
  ): Promise<ServiceResult<{ cleared: number }>> {
    if (input.scope !== 'all' && (input.id === undefined || input.id.length === 0)) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.common.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST, {
        fieldErrors: { id: ['Required unless clearing everything.'] },
      });
    }

    const filter =
      input.scope === 'entry'
        ? { _id: input.id }
        : input.scope === 'place'
          ? { placeId: input.id }
          : input.scope === 'query'
            ? { query: new RegExp(`^${escapeRegex(input.id ?? '')}$`, 'i') }
            : {};

    const result = await ChowdeckOfferModel.deleteMany(filter).exec();
    logger.info('chowdeck cache cleared', { scope: input.scope, id: input.id, cleared: result.deletedCount, by: actorId });
    return ok({ cleared: result.deletedCount });
  }

  /** Meals × places, from the cache alone. A blank cell was never asked; a zero was asked and came back empty. */
  async coverage(): Promise<ServiceResult<unknown>> {
    const [meals, places, rows] = await Promise.all([
      MealModel.find({ status: 'published' }, { slug: 1, name: 1 }).sort({ name: 1 }).lean().exec(),
      ChowdeckPlaceModel.find({ active: true }, { name: 1, city: 1 }).sort({ city: 1, name: 1 }).lean().exec(),
      ChowdeckOfferModel.find({}, { placeId: 1, query: 1, status: 1, fetchedAt: 1, vendors: 1 }).lean().exec(),
    ]);

    const now = new Date();
    // Keyed on the SENT query, not the raw name: rows are stored under the
    // normalised one, so matching on `m.name` would orphan every cell whose
    // meal had "Nigerian" in it.
    const byQuery = new Map(meals.map((m) => [chowdeckQuery(m.name).toLowerCase(), m.slug]));

    return ok({
      meals: meals.map((m) => ({ slug: m.slug, name: m.name })),
      places: places.map((p) => ({ id: p._id, name: p.name, city: p.city })),
      cells: rows
        .map((row) => {
          const slug = byQuery.get(row.query.trim().toLowerCase());
          if (slug === undefined) return null;
          const ranked = rankOffers(row.vendors, now, env.CHOWDECK_WEB_BASE);
          return {
            id: row._id,
            place_id: row.placeId,
            meal_slug: slug,
            status: row.status,
            freshness: freshness(row),
            vendors: row.vendors.length,
            open_now: ranked.open.length,
            later: ranked.later.length,
            fetched_at: isoOrNull(row.fetchedAt),
          };
        })
        .filter((c) => c !== null),
    });
  }

  async fetchAhead(
    input: { meal_slugs: string[]; place_ids: string[]; force: boolean },
    actorId: string,
  ): Promise<ServiceResult<{ job_id: string; pairs: number; capped: boolean }>> {
    const [meals, places] = await Promise.all([
      MealModel.countDocuments({
        status: 'published',
        ...(input.meal_slugs.length > 0 && { slug: { $in: input.meal_slugs } }),
      }).exec(),
      ChowdeckPlaceModel.countDocuments({
        active: true,
        ...(input.place_ids.length > 0 && { _id: { $in: input.place_ids } }),
      }).exec(),
    ]);
    const pairs = meals * places;
    if (pairs === 0) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.common.VALIDATION_ERROR, HTTP_STATUS.BAD_REQUEST, {
        overrideMessage: 'No published meals or active places match that selection.',
      });
    }

    const payload: FetchAheadPayload = {
      actorId,
      mealSlugs: input.meal_slugs,
      placeIds: input.place_ids,
      force: input.force,
    };
    const job = await jobQueue.enqueue({ type: FETCH_AHEAD_JOB_TYPE, ownerId: actorId, payload, maxAttempts: 1 });
    return ok({ job_id: job._id, pairs: Math.min(pairs, MAX_FETCH_AHEAD_PAIRS), capped: pairs > MAX_FETCH_AHEAD_PAIRS });
  }

  // ── The request log ────────────────────────────────────────────────────

  async listCalls(query: {
    kind?: string | undefined;
    status?: string | undefined;
    trigger?: string | undefined;
    q?: string | undefined;
    place_id?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    limit?: number | undefined;
    skip?: number | undefined;
  }): Promise<ServiceResult<unknown>> {
    const filter: Record<string, unknown> = {};
    if (query.kind !== undefined) filter['kind'] = query.kind;
    if (query.status !== undefined) filter['status'] = query.status;
    if (query.trigger !== undefined) filter['trigger'] = query.trigger;
    if (query.place_id !== undefined) filter['params.address_id'] = query.place_id;
    if (query.q !== undefined && query.q.trim().length > 0) {
      const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
      filter['$or'] = [{ 'params.query': pattern }, { 'params.input': pattern }];
    }
    const range: Record<string, Date> = {};
    if (query.from !== undefined) range['$gte'] = new Date(query.from);
    if (query.to !== undefined) range['$lte'] = new Date(query.to);
    if (Object.keys(range).length > 0) filter['createdAt'] = range;

    const limit = Math.min(query.limit ?? 50, 200);
    const [rows, total] = await Promise.all([
      ChowdeckCallModel.find(filter)
        // Bodies are up to half a megabyte each; the list never carries them.
        .select('-responseBody')
        .sort({ createdAt: -1 })
        .skip(query.skip ?? 0)
        .limit(limit)
        .lean()
        .exec(),
      ChowdeckCallModel.countDocuments(filter).exec(),
    ]);

    return ok({ items: rows.map(callSummary), total });
  }

  async callDetail(id: string): Promise<ServiceResult<unknown>> {
    const row = await ChowdeckCallModel.findById(id).lean().exec();
    if (row === null) return notFound();

    let parsedBody: unknown = null;
    if (row.responseBody !== null && !row.truncated) {
      try {
        parsedBody = JSON.parse(row.responseBody);
      } catch {
        parsedBody = null;
      }
    }

    const [cacheRow, replays] = await Promise.all([
      ChowdeckOfferModel.findOne({ callId: row._id }, { _id: 1 }).lean().exec(),
      ChowdeckCallModel.find({ replayOf: row._id }).select('-responseBody').sort({ createdAt: -1 }).limit(20).lean().exec(),
    ]);

    return ok({
      ...callSummary(row),
      request_headers: row.requestHeaders ?? {},
      response_headers: row.responseHeaders ?? null,
      response_body: row.responseBody,
      response_json: parsedBody,
      cache_entry_id: cacheRow?._id ?? null,
      replays: replays.map(callSummary),
    });
  }

  /**
   * Sends the same request again, now.
   *
   * A replayed search also refreshes the cache — it IS a fresh answer, and
   * throwing it away would mean paying for the call twice to use it.
   */
  async replay(id: string, actorId: string): Promise<ServiceResult<unknown>> {
    const row = await ChowdeckCallModel.findById(id, { kind: 1, params: 1 }).lean().exec();
    if (row === null) return notFound();
    const params = row.params;

    if (row.kind === 'autocomplete') {
      const outcome = await chowdeckClient.autocomplete(params['input'] ?? '', {
        trigger: 'replay',
        actorId,
        replayOf: id,
      });
      return ok({ call: outcomeView(outcome) });
    }

    const placeId = params['address_id'];
    const query = params['query'];
    if (placeId === undefined || query === undefined) return notFound();

    const existing = await ChowdeckOfferModel.findOne({ callId: id }, { mealSlug: 1 }).lean().exec();
    const result = await chowdeckService.refresh(placeId, query, existing?.mealSlug ?? null, {
      trigger: 'replay',
      actorId,
      replayOf: id,
    });
    return ok({ call: outcomeView(result.outcome), cache_updated: result.row !== null });
  }

  // ── Clicks ─────────────────────────────────────────────────────────────

  async listClicks(query: { limit?: number | undefined; skip?: number | undefined }): Promise<ServiceResult<unknown>> {
    const limit = Math.min(query.limit ?? 50, 200);
    const [rows, total] = await Promise.all([
      ChowdeckClickModel.find().sort({ createdAt: -1 }).skip(query.skip ?? 0).limit(limit).lean().exec(),
      ChowdeckClickModel.countDocuments().exec(),
    ]);
    return ok({
      items: rows.map((r) => ({
        id: r._id,
        vendor_id: r.vendorId,
        vendor_name: r.vendorName,
        product_id: r.productId,
        meal_slug: r.mealSlug,
        place_id: r.placeId,
        position: r.position,
        mode: r.mode,
        url: r.url,
        created_at: isoOrNull(r.createdAt),
      })),
      total,
    });
  }
}

export const chowdeckAdminService = ChowdeckAdminService.getInstance();
