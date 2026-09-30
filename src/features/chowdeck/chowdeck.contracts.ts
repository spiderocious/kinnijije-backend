import { z } from 'zod';

/**
 * What Chowdeck sends us, checked before it is believed.
 *
 * This is their CUSTOMER API, not a partner contract: it can change shape
 * without notice. So the schemas below name only the fields we read, and let
 * everything else through untouched — a new field on their side must not
 * break us, but a missing field we depend on must.
 *
 * Samples: docs/chowdeck-docs.md and docs/restaurant-api.response.json.
 */

/** Their numbers arrive as numbers or as strings ("2.50"), depending on the field. */
const looseNumber = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'not a number' });
    return z.NEVER;
  }
  return n;
});

const nullableNumber = looseNumber.nullable().optional();

// ── Place autocomplete ───────────────────────────────────────────────────

export const AutocompletePredictionSchema = z
  .object({
    description: z.string(),
    place_id: z.union([z.string(), z.number()]).transform(String),
    structured_formatting: z
      .object({
        main_text: z.string(),
        secondary_text: z.string().optional().nullable(),
      })
      .passthrough()
      .optional(),
    types: z.array(z.string()).default([]),
  })
  .passthrough();

export const AutocompleteResponseSchema = z
  .object({
    predictions: z.array(AutocompletePredictionSchema),
    status: z.string().optional(),
  })
  .passthrough();

export type AutocompletePrediction = z.infer<typeof AutocompletePredictionSchema>;

// ── Product search ───────────────────────────────────────────────────────

/**
 * "HHMM", however it arrives. Most vendors send "2015"; some send 2015, and a
 * morning time as a number loses its leading zero (800 for "0800"), so
 * numbers are padded back to four digits.
 */
const hhmm = z
  .union([z.string(), z.number().int().nonnegative()])
  .transform((value) => (typeof value === 'number' ? String(value).padStart(4, '0') : value.trim()));

const HoursSchema = z
  .object({
    opening: hhmm.nullable().optional(),
    closing: hhmm.nullable().optional(),
    is_open: z.boolean().nullable().optional(),
  })
  .passthrough();

export const ChowdeckProductSchema = z
  .object({
    id: z.union([z.number(), z.string()]).transform(String),
    name: z.string(),
    description: z.string().nullable().optional(),
    price: looseNumber,
    price_description: z.string().nullable().optional(),
    in_stock: z.boolean().nullable().optional(),
    is_published: z.boolean().nullable().optional(),
    is_active: z.boolean().nullable().optional(),
    images: z
      .array(z.object({ path: z.string() }).passthrough())
      .nullable()
      .optional(),
  })
  .passthrough();

export const ChowdeckVendorSchema = z
  .object({
    id: z.union([z.number(), z.string()]).transform(String),
    name: z.string(),
    slug: z.string().min(1),
    location: z.string().min(1),
    logo_url: z.string().nullable().optional(),
    cover_images: z
      .array(z.object({ path: z.string() }).passthrough())
      .nullable()
      .optional(),
    average_rating: nullableNumber,
    number_of_rating: nullableNumber,
    is_open: z.boolean().nullable().optional(),
    current_is_open_state: nullableNumber,
    is_temporarily_unavailable: z.boolean().nullable().optional(),
    temporarily_unavailable_tag: z.string().nullable().optional(),
    available_hours: z.record(z.string(), HoursSchema).nullable().optional(),
    delivery_price: nullableNumber,
    minimum_delivery_time: nullableNumber,
    maximum_delivery_time: nullableNumber,
    distance: nullableNumber,
    products: z.array(z.unknown()).default([]),
  })
  .passthrough();

/**
 * The envelope only. Vendors are parsed one at a time afterwards, so one odd
 * restaurant does not throw away sixteen good ones. If EVERY vendor fails, the
 * response as a whole is treated as a parse failure.
 */
export const SearchResponseSchema = z
  .object({
    status: z.string().optional(),
    message: z.string().optional(),
    data: z.array(z.unknown()),
  })
  .passthrough();

export type ChowdeckVendor = z.infer<typeof ChowdeckVendorSchema>;
export type ChowdeckProduct = z.infer<typeof ChowdeckProductSchema>;
