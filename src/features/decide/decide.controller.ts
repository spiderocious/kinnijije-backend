import type { Request, Response } from 'express';

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

    if (req.headers['if-none-match'] === etag) {
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

    const result = await decideService.decide(input);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },
};
