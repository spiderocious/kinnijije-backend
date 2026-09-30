import type { Request, Response } from 'express';

import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';
import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';

import { decideOptions } from './decide.options.js';
import { decideStats, STATS_TTL_MS } from './decide.stats.js';
import { decideService } from './decide.service.js';
import type { DecideInputRaw } from './decide.schema.js';
import type { DecideInput, Mood, Weight } from './decide.types.js';

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
      rejected_count: input.rejected.length,
      // The empty sentinel: nothing matched at all. These properties together
      // are the recipe coverage hole, stated precisely.
      is_empty: view.verdict.meal_id === '',
    });

    ResponseUtil.ok(res, view);
  },
};
