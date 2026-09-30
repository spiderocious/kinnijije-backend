import { z } from 'zod';

import { CALL_KINDS, CALL_STATUSES, CALL_TRIGGERS } from './chowdeck.model.js';

const id = z.string().trim().min(1).max(60);

const pagination = {
  limit: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
};

// ── Public ───────────────────────────────────────────────────────────────

export const SearchPlacesSchema = z.object({
  q: z.string().max(60).optional(),
});

export const OffersQuerySchema = z.object({
  meal: z.string().trim().min(1).max(120),
  place: id,
  mode: z.enum(['cook', 'order']).optional(),
});

/** A tap through to Chowdeck, reported by the browser as it leaves. */
export const ClickSchema = z.object({
  vendor_id: id,
  product_id: z.string().max(60).optional(),
  meal: z.string().max(120).optional(),
  place: z.string().max(60).optional(),
  position: z.number().int().min(0).max(100).optional(),
  mode: z.enum(['cook', 'order']).optional(),
});

// ── Console ──────────────────────────────────────────────────────────────

export const IdParamSchema = z.object({ id });
export const PlaceParamSchema = z.object({ placeId: id });

export const AutocompleteSchema = z.object({
  input: z.string().trim().min(2).max(80),
});

export const SavePlaceSchema = z.object({
  place_id: id,
  description: z.string().trim().min(1).max(200),
  main_text: z.string().trim().min(1).max(120),
  secondary_text: z.string().max(200).nullable().optional(),
  types: z.array(z.string().max(40)).max(20).optional(),
  city: z.string().trim().max(60).nullable().optional(),
  searched_with: z.string().max(80).nullable().optional(),
});

export const UpdatePlaceSchema = z
  .object({
    active: z.boolean().optional(),
    city: z.string().trim().max(60).nullable().optional(),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' });

export const ImportPlacesSchema = z.object({
  /** Omitted: the default list in chowdeck.places-seed.ts. */
  places: z
    .array(
      z.object({
        query: z.string().trim().min(2).max(80),
        city: z.string().trim().min(1).max(60),
        /** The picker group. Defaults to the city, so a one-off import is its own group. */
        state: z.string().trim().min(1).max(60).optional(),
      }),
    )
    .min(1)
    .max(200)
    .optional(),
});

export const ListCacheSchema = z.object({
  place_id: z.string().max(60).optional(),
  q: z.string().max(120).optional(),
  status: z.enum(['ok', 'empty']).optional(),
  freshness: z.enum(['fresh', 'stale', 'expired']).optional(),
  ...pagination,
});

export const ClearCacheSchema = z.object({
  scope: z.enum(['entry', 'place', 'query', 'all']),
  id: z.string().max(120).optional(),
});

export const FetchAheadSchema = z.object({
  meal_slugs: z.array(z.string().min(1).max(120)).max(500).default([]),
  place_ids: z.array(id).max(200).default([]),
  force: z.boolean().default(false),
});

export const ListCallsSchema = z.object({
  kind: z.enum(CALL_KINDS).optional(),
  status: z.enum(CALL_STATUSES).optional(),
  trigger: z.enum(CALL_TRIGGERS).optional(),
  q: z.string().max(120).optional(),
  place_id: z.string().max(60).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  ...pagination,
});

export const ListClicksSchema = z.object({ ...pagination });
