import type { Request, Response } from 'express';

import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';
import { ResponseUtil } from '@lib/response.js';
import { bail, fail } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/index.js';

import { decideHistoryService } from './decide-history.service.js';
import { decideOptions } from './decide.options.js';
import { decideStats, STATS_TTL_MS } from './decide.stats.js';
import { decideService } from './decide.service.js';
import type { DecideInputRaw } from './decide.schema.js';
import type { DecideInput, Mood, Weight } from './decide.types.js';

/**
 * The route is behind `authenticate`, so this is unreachable in practice.
 * It exists because the actor is typed as optional and an assertion here
 * would be a crash where a refusal is the honest answer.
 */
const unauthenticated = () =>
  fail(ERROR_CODES.UNAUTHENTICATED, MESSAGE_KEYS.auth.UNAUTHENTICATED, HTTP_STATUS.UNAUTHORIZED);

export const decideController = {
  /**
   * The tiles.
   *
   * Public, constant and identical for everybody, so it is cached hard at both
   * layers. The ETag is the payload's own fingerprint: editing the catalogue
   * changes the hash, every cached copy stops matching, and nothing has to be
   * purged by hand.
   *
   * A repeat visit costs a 304 with no body — which matters on the connection
   * this flow is actually used on.
   */
  options: (req: Request, res: Response): void => {
    const view = decideOptions();
    const etag = `"${view.version}"`;

    res.setHeader('ETag', etag);
    // A day in the browser, and a stale copy may be served for a week while a
    // fresh one is fetched behind it — the tiles changing an hour late is not
    // a problem worth a blocking request for.
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

    const anonId = analytics.anonymousId(req.ip ?? 'unknown');
    const cacheHit = req.headers['if-none-match'] === etag;

    analytics.track(SERVER_EVENTS.DECIDE_OPTIONS_SERVED, anonId, {
      cache_hit: cacheHit,
      total_items: view.total_items,
      version: view.version,
    });

    if (cacheHit) {
      res.status(304).end();
      return;
    }

    ResponseUtil.ok(res, view);
  },

  /**
   * The counters on the front door.
   *
   * Public, and cached for three hours server-side. The same window is set on
   * the response so a CDN and the browser hold it too: recomputing this per
   * visitor would be a database scan on the most-hit page in the product.
   */
  stats: async (_req: Request, res: Response): Promise<void> => {
    const stats = await decideStats();
    const seconds = Math.round(STATS_TTL_MS / 1000);
    res.setHeader(
      'Cache-Control',
      `public, max-age=${String(seconds)}, stale-while-revalidate=${String(seconds * 2)}`,
    );
    ResponseUtil.ok(res, stats);
  },

  /**
   * A cook's own past decisions.
   *
   * AUTHENTICATED, unlike everything else on this router: history belongs to
   * an account. The owner comes off the verified token and is never read from
   * the request, so one cook cannot ask for another's rows.
   */
  history: async (req: Request, res: Response): Promise<void> => {
    const ownerId = req.actor?.userId;
    if (ownerId === undefined) return bail(unauthenticated());

    ResponseUtil.ok(res, await decideHistoryService.list(ownerId));
  },

  historyEntry: async (req: Request, res: Response): Promise<void> => {
    const ownerId = req.actor?.userId;
    if (ownerId === undefined) return bail(unauthenticated());

    const entry = await decideHistoryService.get(ownerId, req.params.id ?? '');
    // Somebody else's id and a made-up one are the SAME answer on purpose: a
    // 403 would confirm the row exists, which is itself a leak.
    if (entry === null) {
      return bail(
        fail(
          ERROR_CODES.NOT_FOUND,
          MESSAGE_KEYS.decideHistory.NOT_FOUND,
          HTTP_STATUS.NOT_FOUND,
        ),
      );
    }

    ResponseUtil.ok(res, entry);
  },

  removeHistoryEntry: async (req: Request, res: Response): Promise<void> => {
    const ownerId = req.actor?.userId;
    if (ownerId === undefined) return bail(unauthenticated());

    const removed = await decideHistoryService.remove(ownerId, req.params.id ?? '');
    if (!removed) {
      return bail(
        fail(
          ERROR_CODES.NOT_FOUND,
          MESSAGE_KEYS.decideHistory.NOT_FOUND,
          HTTP_STATUS.NOT_FOUND,
        ),
      );
    }

    ResponseUtil.noContent(res);
  },

  decide: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as DecideInputRaw;

    const input: DecideInput = {
      kitchenItems: body.kitchen_items,
      kitchenSkipped: body.kitchen_skipped,
      mood: body.mood as Mood,
      weight: body.weight as Weight,
      minutes: body.minutes,
      city: body.city,
      rejected: body.rejected,
      mode: body.mode,
      placeId: body.place_id,
    };

    const started = Date.now();
    // The IP is hashed inside the service; it is never stored raw.
    // The actor is present only when a token was sent: optionalAuthenticate
    // lets a guest through without one.
    const result = await decideService.decide(input, req.ip ?? 'unknown', req.actor?.userId);
    if (!result.success) return bail(result);

    /**
     * Server truth for the funnel that matters most.
     *
     * The client sends its own version of this, which an ad blocker can stop;
     * this one cannot be blocked, so the `provenance` split here is the honest
     * AI-versus-fallback ratio.
     */
    const view = result.data;
    analytics.track(SERVER_EVENTS.DECIDE_SERVED, analytics.anonymousId(req.ip ?? 'unknown'), {
      provenance: view.provenance,
      duration_ms: Date.now() - started,
      candidate_count: view.alternates.length + 1,
      pool_count: view.pool.length,
      match_score: view.verdict.match.score,
      missing_count: view.verdict.match.missing.length,
      have_count: view.verdict.match.have.length,
      kitchen_item_count: input.kitchenItems.length,
      kitchen_skipped: input.kitchenSkipped,
      mood: input.mood,
      weight: input.weight,
      minutes: input.minutes,
      city: input.city ?? null,
      // How many people say "I'll order" is the first number Chowdeck will ask for.
      mode: input.mode ?? 'cook',
      place_id: input.placeId ?? null,
      rejected_count: input.rejected.length,
      // The empty sentinel: nothing matched at all. These properties together
      // are the recipe coverage hole, stated precisely.
      is_empty: view.verdict.meal_id === '',
    });

    ResponseUtil.ok(res, view);
  },
};
