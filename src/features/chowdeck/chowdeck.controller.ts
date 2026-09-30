import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import { chowdeckAdminService } from './chowdeck.admin.service.js';
import { ensurePlacesSeeded } from './chowdeck.jobs.js';
import { chowdeckService } from './chowdeck.service.js';
import type { z } from 'zod';
import type {
  ClearCacheSchema,
  ClickSchema,
  FetchAheadSchema,
  ImportPlacesSchema,
  ListCacheSchema,
  ListCallsSchema,
  ListClicksSchema,
  OffersQuerySchema,
  SavePlaceSchema,
  UpdatePlaceSchema,
} from './chowdeck.schema.js';

const ip = (req: Request): string => req.ip ?? 'unknown';
const param = (req: Request, name: string): string => (req.params as Record<string, string>)[name] ?? '';

export const chowdeckController = {
  // ── Public ─────────────────────────────────────────────────────────────

  searchPlaces: async (req: Request, res: Response): Promise<void> => {
    const { q } = req.query as { q?: string };
    const result = await chowdeckService.searchPlaces(q);
    if (!result.success) return bail(result);

    // First run: nothing saved yet. Queue the default import once and answer
    // now — the cook gets the city field meanwhile, never a wait.
    if (result.data.length === 0) void ensurePlacesSeeded();

    // Places change when somebody edits them in the console, which is rare.
    // An EMPTY answer is not cached: it is about to change as the import lands.
    res.setHeader('Cache-Control', result.data.length === 0 ? 'no-store' : 'public, max-age=300');
    ResponseUtil.ok(res, result.data);
  },

  offers: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as z.infer<typeof OffersQuerySchema>;
    const result = await chowdeckService.offers(
      { mealSlug: query.meal, placeId: query.place, mode: query.mode },
      ip(req),
    );
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  /**
   * A tap through, reported as the browser leaves for Chowdeck.
   *
   * Always 204, whatever happened: the cook is already on their way, nothing
   * reads this answer, and telling a caller which vendor ids we recognise
   * would only help somebody probing the endpoint.
   */
  click: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof ClickSchema>;
    await chowdeckService.recordClick(
      body.vendor_id,
      {
        productId: body.product_id,
        mealSlug: body.meal,
        placeId: body.place,
        position: body.position,
        mode: body.mode,
      },
      ip(req),
    );
    ResponseUtil.noContent(res);
  },

  // ── Console ────────────────────────────────────────────────────────────

  overview: async (_req: Request, res: Response): Promise<void> => {
    const result = await chowdeckAdminService.overview();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  resetBreaker: (req: Request, res: Response): void => {
    chowdeckAdminService.resetBreaker(requireActor(req).userId);
    ResponseUtil.noContent(res);
  },

  listPlaces: async (_req: Request, res: Response): Promise<void> => {
    const result = await chowdeckAdminService.listPlaces();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  autocomplete: async (req: Request, res: Response): Promise<void> => {
    const { input } = req.body as { input: string };
    const result = await chowdeckAdminService.autocomplete(input, requireActor(req).userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  savePlace: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof SavePlaceSchema>;
    const result = await chowdeckAdminService.savePlace(body, requireActor(req).userId);
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  updatePlace: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof UpdatePlaceSchema>;
    const result = await chowdeckAdminService.updatePlace(param(req, 'placeId'), body);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  deletePlace: async (req: Request, res: Response): Promise<void> => {
    const result = await chowdeckAdminService.deletePlace(param(req, 'placeId'), requireActor(req).userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  purgePlaces: async (req: Request, res: Response): Promise<void> => {
    const result = await chowdeckAdminService.purgePlaces(requireActor(req).userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  importPlaces: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof ImportPlacesSchema>;
    const result = await chowdeckAdminService.importPlaces(body, requireActor(req).userId);
    if (!result.success) return bail(result);
    ResponseUtil.accepted(res, result.data);
  },

  listCache: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as z.infer<typeof ListCacheSchema>;
    const result = await chowdeckAdminService.listCache(query);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  cacheDetail: async (req: Request, res: Response): Promise<void> => {
    const result = await chowdeckAdminService.cacheDetail(param(req, 'id'));
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  refreshCache: async (req: Request, res: Response): Promise<void> => {
    const result = await chowdeckAdminService.refreshCache(param(req, 'id'), requireActor(req).userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  clearCache: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof ClearCacheSchema>;
    const result = await chowdeckAdminService.clearCache(body, requireActor(req).userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  coverage: async (_req: Request, res: Response): Promise<void> => {
    const result = await chowdeckAdminService.coverage();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  fetchAhead: async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof FetchAheadSchema>;
    const result = await chowdeckAdminService.fetchAhead(body, requireActor(req).userId);
    if (!result.success) return bail(result);
    ResponseUtil.accepted(res, result.data);
  },

  listCalls: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as z.infer<typeof ListCallsSchema>;
    const result = await chowdeckAdminService.listCalls(query);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  callDetail: async (req: Request, res: Response): Promise<void> => {
    const result = await chowdeckAdminService.callDetail(param(req, 'id'));
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  replay: async (req: Request, res: Response): Promise<void> => {
    const result = await chowdeckAdminService.replay(param(req, 'id'), requireActor(req).userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  listClicks: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as z.infer<typeof ListClicksSchema>;
    const result = await chowdeckAdminService.listClicks(query);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },
};
