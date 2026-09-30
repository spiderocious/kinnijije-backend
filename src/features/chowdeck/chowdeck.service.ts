import { env } from '@app/env.js';
import { hashIp } from '@features/decide/decide-log.model.js';
import { MealModel } from '@features/meals/meals.model.js';
import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';
import { isoOrNull } from '@lib/dates.js';
import { FEATURE_FLAGS, flagsService } from '@lib/flags/index.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import { chowdeckClient, singleFlight, type CallMeta, type CallOutcome, type SearchData } from './chowdeck.client.js';
import {
  ChowdeckClickModel,
  ChowdeckOfferModel,
  ChowdeckPlaceModel,
  offerKey,
  type ChowdeckOfferAttributes,
  type ChowdeckPlaceAttributes,
} from './chowdeck.model.js';
import { rankOffers, storeUrl, type OfferView } from './chowdeck.offers.js';

/**
 * How long a cached search is trusted.
 *
 *   FRESH  served as is, no call
 *   STALE  served at once, and refreshed once in the background
 *   past   refetched while the cook waits (the cards load after the meal, so
 *          the verdict itself never waits on this)
 *
 * An EMPTY answer is kept for less time: "nobody sells it there" is worth
 * remembering, but not all day.
 *
 * Opening hours are applied at read time, so what goes stale in a cached row
 * is price and stock — which move slowly.
 */
export const FRESH_MS = 6 * 60 * 60 * 1000;
export const STALE_MAX_MS = 24 * 60 * 60 * 1000;
export const EMPTY_FRESH_MS = 60 * 60 * 1000;

export type ServedFrom = 'fresh' | 'stale' | 'live' | 'fallback';

export interface OffersView {
  /**
   *   ok          — at least one restaurant, open now or later
   *   empty       — we asked; nobody there sells it that we can show
   *   unavailable — we could not ask and have nothing cached
   *   disabled    — the offers flag is off; show nothing
   */
  status: 'ok' | 'empty' | 'unavailable' | 'disabled';
  served_from: ServedFrom | null;
  fetched_at: string | null;
  meal: { slug: string; name: string } | null;
  place: { id: string; name: string } | null;
  query: string | null;
  offers: OfferView[];
  later: OfferView[];
  /** Restaurants the search returned, before we filtered. Zero with `ok` never happens. */
  considered: number;
}

const DISABLED: OffersView = {
  status: 'disabled',
  served_from: null,
  fetched_at: null,
  meal: null,
  place: null,
  query: null,
  offers: [],
  later: [],
  considered: 0,
};

/** Serve counts since boot. The console's "how often did the cache save a call". */
const served: Record<ServedFrom | 'unavailable', number> = {
  fresh: 0,
  stale: 0,
  live: 0,
  fallback: 0,
  unavailable: 0,
};
const servedSince = new Date();

export const servedCounters = (): { since: string; counts: typeof served } => ({
  since: servedSince.toISOString(),
  counts: { ...served },
});

type CachedRow = ChowdeckOfferAttributes;

export interface RefreshResult {
  outcome: CallOutcome<SearchData>;
  row: CachedRow | null;
}

export class ChowdeckService {
  private static instance: ChowdeckService | undefined;

  static getInstance(): ChowdeckService {
    ChowdeckService.instance ??= new ChowdeckService();
    return ChowdeckService.instance;
  }

  // ── Places ─────────────────────────────────────────────────────────────

  /**
   * A cook's location search. OUR table only — never a live call — so it is
   * instant, and typing cannot become traffic to Chowdeck.
   */
  async searchPlaces(q: string | undefined): Promise<
    ServiceResult<
      { id: string; name: string; description: string; city: string | null; state: string | null }[]
    >
  > {
    const term = (q ?? '').trim();
    const filter: Record<string, unknown> = { active: true };
    if (term.length > 0) {
      const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter['$or'] = [{ name: pattern }, { description: pattern }, { city: pattern }, { state: pattern }];
    }

    /**
     * In list order: `rank` is the position in the default list, whose first
     * town per state is that state's main city — so each group arrives with
     * its main city first and the picker needs no opinion of its own.
     *
     * Browsing returns everything (a few hundred small rows, cached for five
     * minutes); the picker folds each state down to its first few.
     */
    const rows = await ChowdeckPlaceModel.find(filter)
      .sort({ rank: 1, state: 1, name: 1 })
      .limit(term.length > 0 ? 20 : 500)
      .lean()
      .exec();

    return ok(
      rows.map((row) => ({
        id: row._id,
        name: row.name,
        description: row.description,
        city: row.city,
        state: row.state ?? null,
      })),
    );
  }

  async activePlace(placeId: string): Promise<ChowdeckPlaceAttributes | null> {
    return ChowdeckPlaceModel.findOne({ _id: placeId, active: true }).lean().exec();
  }

  // ── Offers ─────────────────────────────────────────────────────────────

  /**
   * Restaurants selling this meal in this place.
   *
   * Only published meals and saved places are accepted, and the query is the
   * meal's own name — never text a client typed. That bounds the set of
   * possible searches to meals × places, which is what makes caching them
   * enough protection.
   */
  async offers(
    input: { mealSlug: string; placeId: string; mode?: string | undefined },
    ip: string,
  ): Promise<ServiceResult<OffersView>> {
    if (!(await flagsService.isOn(FEATURE_FLAGS.CHOWDECK_OFFERS))) return ok(DISABLED);

    const [meal, place] = await Promise.all([
      MealModel.findOne({ slug: input.mealSlug, status: 'published' }, { slug: 1, name: 1 })
        .lean()
        .exec(),
      this.activePlace(input.placeId),
    ]);
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    if (place === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND, {
        rejectionReason: 'place_not_saved',
      });
    }

    const query = meal.name.trim();
    const key = offerKey(place._id, query);
    const now = Date.now();
    const cached = await ChowdeckOfferModel.findOne({ key }).lean().exec();
    const age = cached === null ? Number.POSITIVE_INFINITY : now - cached.fetchedAt.getTime();
    const freshFor = cached?.status === 'empty' ? EMPTY_FRESH_MS : FRESH_MS;

    let row: CachedRow | null = null;
    let from: ServedFrom | null = null;

    if (cached !== null && age < freshFor) {
      row = cached;
      from = 'fresh';
    } else if (cached !== null && cached.status === 'ok' && age < STALE_MAX_MS) {
      row = cached;
      from = 'stale';
      // Once, in the background. Single flight means a crowd on one stale row
      // still sends one request.
      void this.refresh(place._id, query, meal.slug, { trigger: 'user' }).catch((error: unknown) => {
        logger.warn('chowdeck background refresh failed', {
          key,
          error: error instanceof Error ? error.message : 'unknown',
        });
      });
    } else {
      const result = await this.refresh(place._id, query, meal.slug, { trigger: 'user' });
      if (result.row !== null) {
        row = result.row;
        from = 'live';
      } else if (cached !== null) {
        // Could not ask (refused, timed out, broke). Old is better than nothing:
        // opening hours are recomputed now, so it is still honest about open/closed.
        row = cached;
        from = 'fallback';
      }
    }

    if (row !== null && (from === 'fresh' || from === 'stale' || from === 'fallback')) {
      void ChowdeckOfferModel.updateOne({ _id: row._id }, { $inc: { hits: 1 }, $set: { lastServedAt: new Date() } })
        .exec()
        .catch(() => undefined);
    }

    served[from ?? 'unavailable'] += 1;

    const ranked = row === null ? null : rankOffers(row.vendors, new Date());
    const hasAny = ranked !== null && ranked.open.length + ranked.later.length > 0;

    const view: OffersView = {
      status: row === null ? 'unavailable' : hasAny ? 'ok' : 'empty',
      served_from: from,
      fetched_at: isoOrNull(row?.fetchedAt),
      meal: { slug: meal.slug, name: meal.name },
      place: { id: place._id, name: place.name },
      query,
      offers: ranked?.open ?? [],
      later: ranked?.later ?? [],
      considered: ranked?.considered ?? 0,
    };

    analytics.track(SERVER_EVENTS.CHOWDECK_OFFERS_SERVED, analytics.anonymousId(ip), {
      meal_slug: meal.slug,
      place_id: place._id,
      city: place.city,
      mode: input.mode ?? null,
      status: view.status,
      served_from: from,
      open_count: view.offers.length,
      later_count: view.later.length,
      considered: view.considered,
    });

    return ok(view);
  }

  /**
   * Asks Chowdeck and rewrites the cache row. Shared by a cook's miss, a
   * background refresh, the console, a replay and the fetch-ahead job.
   *
   * A failed call never touches the row: the last good answer stays, and the
   * failure is in the call log.
   */
  refresh(placeId: string, query: string, mealSlug: string | null, meta: CallMeta): Promise<RefreshResult> {
    const key = offerKey(placeId, query);

    return singleFlight(`search:${key}`, async () => {
      const outcome = await chowdeckClient.search(placeId, query, meta);
      if (outcome.status !== 'ok' || outcome.data === null) return { outcome, row: null };

      const { vendors, rawCount, dropped } = outcome.data;
      const row = await ChowdeckOfferModel.findOneAndUpdate(
        { key },
        {
          $set: {
            placeId,
            query,
            status: vendors.length > 0 ? 'ok' : 'empty',
            vendors,
            rawVendorCount: rawCount,
            droppedVendorCount: dropped,
            fetchedAt: new Date(),
            callId: outcome.callId,
          },
          // The first meal to ask keeps the label; a refresh does not relabel it.
          $setOnInsert: { key, mealSlug, hits: 0, lastServedAt: null },
        },
        { upsert: true, new: true },
      )
        .lean()
        .exec();

      if (dropped > 0) {
        logger.warn('chowdeck vendors failed the schema', { key, dropped, raw: rawCount, call_id: outcome.callId });
      }

      return { outcome, row };
    });
  }

  // ── The tap through ────────────────────────────────────────────────────

  /**
   * Where a tap goes, and a record that it happened.
   *
   * The destination is built from the CACHED vendor, never from the request,
   * so this cannot be turned into an open redirect. An unknown vendor goes to
   * Chowdeck's front page rather than an error: the cook has already left us.
   */
  async redirect(
    vendorId: string,
    context: {
      productId?: string | undefined;
      mealSlug?: string | undefined;
      placeId?: string | undefined;
      position?: number | undefined;
      mode?: string | undefined;
    },
    ip: string,
  ): Promise<string> {
    const row = await ChowdeckOfferModel.findOne(
      { 'vendors.vendorId': vendorId },
      { 'vendors.$': 1 },
    )
      .sort({ fetchedAt: -1 })
      .lean()
      .exec();

    const vendor = row?.vendors[0];
    if (vendor === undefined) return env.CHOWDECK_WEB_BASE;

    const url = storeUrl(env.CHOWDECK_WEB_BASE, vendor);

    void ChowdeckClickModel.create({
      vendorId,
      vendorName: vendor.name,
      productId: context.productId ?? null,
      mealSlug: context.mealSlug ?? null,
      placeId: context.placeId ?? null,
      position: context.position ?? null,
      mode: context.mode ?? null,
      ipHash: hashIp(ip, env.JWT_ACCESS_SECRET),
      url,
    }).catch((error: unknown) => {
      logger.warn('chowdeck click log failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    });

    // Server-side on purpose: an ad blocker stops the browser's copy of this,
    // and this is the number that goes in front of Chowdeck.
    analytics.track(SERVER_EVENTS.CHOWDECK_OFFER_CLICKED, analytics.anonymousId(ip), {
      vendor_id: vendorId,
      vendor_name: vendor.name,
      product_id: context.productId ?? null,
      meal_slug: context.mealSlug ?? null,
      place_id: context.placeId ?? null,
      position: context.position ?? null,
      mode: context.mode ?? null,
    });

    return url;
  }
}

export const chowdeckService = ChowdeckService.getInstance();
