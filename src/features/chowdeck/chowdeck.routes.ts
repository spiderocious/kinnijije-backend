import { Router, type Express } from 'express';

import { RATE_LIMITS } from '@lib/ratelimit/index.js';
import { USER_ROLES, USER_STATUSES } from '@shared/constants/roles.js';
import { asyncHandler } from '@shared/middleware/async-handler.js';
import { authenticate } from '@shared/middleware/authenticate.middleware.js';
import { requireRole, requireStatus } from '@shared/middleware/authorize.middleware.js';
import { byIp, rateLimit } from '@shared/middleware/rate-limit.middleware.js';
import { validate } from '@shared/middleware/validate.middleware.js';

import { chowdeckController } from './chowdeck.controller.js';
import {
  AutocompleteSchema,
  ClearCacheSchema,
  FetchAheadSchema,
  IdParamSchema,
  ImportPlacesSchema,
  ListCacheSchema,
  ListCallsSchema,
  ListClicksSchema,
  OffersQuerySchema,
  PlaceParamSchema,
  RedirectQuerySchema,
  SavePlaceSchema,
  SearchPlacesSchema,
  UpdatePlaceSchema,
  VendorParamSchema,
} from './chowdeck.schema.js';

const router = Router();

/**
 * EVERY route in this file carries its own named rate limit, on top of the
 * global backstop in app.ts. The three public ones are keyed by IP explicitly,
 * like decide: they are public by design and the key should say so.
 *
 * Behind all of these sits the outbound limit in chowdeck.client.ts, which is
 * what actually protects Chowdeck: however these are hit, they cannot make us
 * send more than the per-minute and per-day allowance.
 */

// ── Public ───────────────────────────────────────────────────────────────

// Our table only. Never reaches Chowdeck.
router.get(
  '/places',
  rateLimit(RATE_LIMITS.PLACES_SEARCH, byIp),
  validate(SearchPlacesSchema, 'query'),
  asyncHandler(chowdeckController.searchPlaces),
);

// Cache first; a miss becomes one guarded call.
router.get(
  '/partners/chowdeck/offers',
  rateLimit(RATE_LIMITS.CHOWDECK_OFFERS, byIp),
  validate(OffersQuerySchema, 'query'),
  asyncHandler(chowdeckController.offers),
);

// A lookup and a 302. Never calls Chowdeck.
router.get(
  '/go/chowdeck/:vendorId',
  rateLimit(RATE_LIMITS.CHOWDECK_REDIRECT, byIp),
  validate(VendorParamSchema, 'params'),
  validate(RedirectQuerySchema, 'query'),
  asyncHandler(chowdeckController.redirect),
);

// ── Console ──────────────────────────────────────────────────────────────

const admin = [authenticate, requireStatus(USER_STATUSES.ACTIVE), requireRole(USER_ROLES.ADMIN)];
const read = [...admin, rateLimit(RATE_LIMITS.CHOWDECK_ADMIN_READ)];
const action = [...admin, rateLimit(RATE_LIMITS.CHOWDECK_ADMIN_ACTION)];

/**
 * ROUTE ORDER IS LOAD-BEARING, as in admin.routes.ts: every literal segment
 * (`/autocomplete`, `/import`, `/clear`) is registered before the
 * parameterised route that would swallow it.
 */
router.get('/admin/chowdeck/overview', ...read, asyncHandler(chowdeckController.overview));
router.post('/admin/chowdeck/breaker/reset', ...action, chowdeckController.resetBreaker);
router.get('/admin/chowdeck/coverage', ...read, asyncHandler(chowdeckController.coverage));
router.post(
  '/admin/chowdeck/fetch-ahead',
  ...action,
  validate(FetchAheadSchema),
  asyncHandler(chowdeckController.fetchAhead),
);

// Places
router.get('/admin/chowdeck/places', ...read, asyncHandler(chowdeckController.listPlaces));
router.post(
  '/admin/chowdeck/places/autocomplete',
  ...action,
  validate(AutocompleteSchema),
  asyncHandler(chowdeckController.autocomplete),
);
router.post(
  '/admin/chowdeck/places/import',
  ...action,
  validate(ImportPlacesSchema),
  asyncHandler(chowdeckController.importPlaces),
);
// Every place and its cache, gone. The console asks for a typed confirmation first.
router.post('/admin/chowdeck/places/purge', ...action, asyncHandler(chowdeckController.purgePlaces));
router.post('/admin/chowdeck/places', ...action, validate(SavePlaceSchema), asyncHandler(chowdeckController.savePlace));
router.patch(
  '/admin/chowdeck/places/:placeId',
  ...action,
  validate(PlaceParamSchema, 'params'),
  validate(UpdatePlaceSchema),
  asyncHandler(chowdeckController.updatePlace),
);
router.delete(
  '/admin/chowdeck/places/:placeId',
  ...action,
  validate(PlaceParamSchema, 'params'),
  asyncHandler(chowdeckController.deletePlace),
);

// Cache
router.post('/admin/chowdeck/cache/clear', ...action, validate(ClearCacheSchema), asyncHandler(chowdeckController.clearCache));
router.get('/admin/chowdeck/cache', ...read, validate(ListCacheSchema, 'query'), asyncHandler(chowdeckController.listCache));
router.post(
  '/admin/chowdeck/cache/:id/refresh',
  ...action,
  validate(IdParamSchema, 'params'),
  asyncHandler(chowdeckController.refreshCache),
);
router.get(
  '/admin/chowdeck/cache/:id',
  ...read,
  validate(IdParamSchema, 'params'),
  asyncHandler(chowdeckController.cacheDetail),
);

// The request log
router.get('/admin/chowdeck/calls', ...read, validate(ListCallsSchema, 'query'), asyncHandler(chowdeckController.listCalls));
router.post(
  '/admin/chowdeck/calls/:id/replay',
  ...action,
  validate(IdParamSchema, 'params'),
  asyncHandler(chowdeckController.replay),
);
router.get(
  '/admin/chowdeck/calls/:id',
  ...read,
  validate(IdParamSchema, 'params'),
  asyncHandler(chowdeckController.callDetail),
);

// Clicks
router.get('/admin/chowdeck/clicks', ...read, validate(ListClicksSchema, 'query'), asyncHandler(chowdeckController.listClicks));

export function register(app: Express): void {
  app.use('/api/v1', router);
}
