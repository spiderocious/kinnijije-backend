import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * Everything we keep about Chowdeck, in four collections:
 *
 *   chowdeck_places   where a cook can ask about — searched locally, never live
 *   chowdeck_offers   one cached search per (place, query)
 *   chowdeck_calls    every request we sent them, with what came back
 *   chowdeck_clicks   every tap through to their site
 */

// ── Places ───────────────────────────────────────────────────────────────

/**
 * A place Chowdeck knows, saved so a cook's location search never reaches them.
 *
 * `_id` IS Chowdeck's place id, which their search accepts as `address_id` —
 * so there is exactly one row per place and nothing to translate.
 */
export interface ChowdeckPlaceAttributes {
  _id: string;
  /** "Surulere" — the short name shown on a chip. */
  name: string;
  /** "Surulere, Lagos, Nigeria" — the full line shown in search results. */
  description: string;
  secondary: string | null;
  /**
   * The city it belongs to, for weather and for grouping in the console.
   * Ours, not theirs: set from the seed list or by whoever saved it.
   */
  city: string | null;
  /** The group it is shown under in the picker. Null for places saved by hand without one. */
  state: string | null;
  /**
   * Its position in the default list — 0 is the first (main) town of its
   * state. The picker orders by this, so the main city leads its group.
   * Places saved by hand sort after the list.
   */
  rank: number;
  types: string[];
  /** A hidden place is kept (its cache is still valid) but never offered to cooks. */
  active: boolean;
  /** What we typed into their autocomplete to find it. */
  searchedWith: string | null;
  addedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const placeSchema = new Schema<ChowdeckPlaceAttributes>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    secondary: { type: String, default: null },
    city: { type: String, default: null, index: true },
    state: { type: String, default: null, index: true },
    rank: { type: Number, required: true, default: 100_000 },
    types: { type: [String], default: [] },
    active: { type: Boolean, required: true, default: true, index: true },
    searchedWith: { type: String, default: null },
    addedBy: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'chowdeck_places' },
);

export type ChowdeckPlaceDocument = HydratedDocument<ChowdeckPlaceAttributes>;
export const ChowdeckPlaceModel = model<ChowdeckPlaceAttributes>('ChowdeckPlace', placeSchema);

// ── Cached searches ──────────────────────────────────────────────────────

/** Weekly hours, as Chowdeck states them: "HHMM" strings, Lagos time. */
export interface StoredHours {
  opening: string | null;
  closing: string | null;
  isOpen: boolean;
}

export interface StoredProduct {
  productId: string;
  name: string;
  description: string | null;
  /** Kobo, exactly as sent. Converted to naira only at the edge. */
  priceKobo: number;
  priceDescription: string | null;
  inStock: boolean;
  imageUrl: string | null;
}

/**
 * One restaurant from one search, reduced to what we show.
 *
 * Reduced on purpose: the raw response is in the call log for anybody who
 * needs the rest, and a cache that stores everything is a cache nobody can
 * read in the console.
 */
export interface StoredVendor {
  vendorId: string;
  name: string;
  slug: string;
  /** "Ijesha Tedo" — also the area segment of their store URL. */
  area: string;
  logoUrl: string | null;
  coverUrl: string | null;
  rating: number | null;
  ratingCount: number;
  deliveryFeeKobo: number | null;
  minDeliveryMinutes: number | null;
  maxDeliveryMinutes: number | null;
  distanceKm: number | null;
  /** Keyed by lowercase day name, plus `default`. */
  hours: Record<string, StoredHours>;
  temporarilyUnavailable: boolean;
  unavailableReason: string | null;
  /** Their own open flag AT FETCH TIME. Shown in the console; the app computes from hours. */
  openAtFetch: boolean | null;
  products: StoredProduct[];
}

/**
 *   ok     — they answered with at least one restaurant
 *   empty  — they answered, and nobody sells it there. Cached too, for less time,
 *            so a dish nobody sells is not re-asked every time somebody sees it
 */
export type OfferCacheStatus = 'ok' | 'empty';

export interface ChowdeckOfferAttributes {
  _id: string;
  /** `${placeId}:${query lowercased}` — the one thing a lookup needs. */
  key: string;
  placeId: string;
  /** Exactly what was sent as `query`. */
  query: string;
  /** The meal that first asked, for the coverage grid. A query can outlive its meal. */
  mealSlug: string | null;
  status: OfferCacheStatus;
  vendors: StoredVendor[];
  /** How many vendors the response carried before our own parsing dropped any. */
  rawVendorCount: number;
  /** Vendors dropped because they did not match the schema. Non-zero means their shape moved. */
  droppedVendorCount: number;
  fetchedAt: Date;
  /** The call that produced this, so the console can jump to the raw body. */
  callId: string;
  /** Times served from here instead of calling them. */
  hits: number;
  lastServedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<StoredProduct>(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    priceKobo: { type: Number, required: true },
    priceDescription: { type: String, default: null },
    inStock: { type: Boolean, required: true },
    imageUrl: { type: String, default: null },
  },
  { _id: false },
);

const vendorSchema = new Schema<StoredVendor>(
  {
    vendorId: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    area: { type: String, required: true },
    logoUrl: { type: String, default: null },
    coverUrl: { type: String, default: null },
    rating: { type: Number, default: null },
    ratingCount: { type: Number, required: true, default: 0 },
    deliveryFeeKobo: { type: Number, default: null },
    minDeliveryMinutes: { type: Number, default: null },
    maxDeliveryMinutes: { type: Number, default: null },
    distanceKm: { type: Number, default: null },
    // Mixed, not a Map: a Mongoose Map reads back as a Map when hydrated and
    // as a plain object when lean, and this is read both ways.
    hours: { type: Schema.Types.Mixed, default: {} },
    temporarilyUnavailable: { type: Boolean, required: true, default: false },
    unavailableReason: { type: String, default: null },
    openAtFetch: { type: Boolean, default: null },
    products: { type: [productSchema], default: [] },
  },
  { _id: false },
);

const offerSchema = new Schema<ChowdeckOfferAttributes>(
  {
    _id: { type: String, default: () => newId('chowdeckOffer') },
    key: { type: String, required: true, unique: true },
    placeId: { type: String, required: true, index: true },
    query: { type: String, required: true, index: true },
    mealSlug: { type: String, default: null, index: true },
    status: { type: String, required: true, enum: ['ok', 'empty'] },
    vendors: { type: [vendorSchema], default: [] },
    rawVendorCount: { type: Number, required: true, default: 0 },
    droppedVendorCount: { type: Number, required: true, default: 0 },
    fetchedAt: { type: Date, required: true },
    callId: { type: String, required: true },
    hits: { type: Number, required: true, default: 0 },
    lastServedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'chowdeck_offers' },
);

// The redirect finds a vendor's URL by id, across every cached search.
offerSchema.index({ 'vendors.vendorId': 1 });

export type ChowdeckOfferDocument = HydratedDocument<ChowdeckOfferAttributes>;
export const ChowdeckOfferModel = model<ChowdeckOfferAttributes>('ChowdeckOffer', offerSchema);

/**
 * A meal name as Chowdeck should see it.
 *
 * "Nigerian" is stripped because it is how WE classify a dish, not how a
 * vendor lists it: nobody sells "Nigerian Jollof Rice", they sell "Jollof
 * Rice", and the extra word narrows a search that should have been wide.
 *
 * Deliberately a whole-word match, case-insensitive. A substring replace would
 * also eat the middle of a word, and the apostrophe case ("Nigerian-style")
 * is handled by collapsing whatever separator is left behind.
 *
 * It NEVER returns empty: a meal called exactly "Nigerian" would otherwise
 * become a blank query, which searches everything rather than nothing. The
 * original name is the honest fallback there.
 */
export function chowdeckQuery(mealName: string): string {
  const stripped = mealName
    // "Nigerian-style" is one idea, so the suffix goes with the word. Handled
    // before the bare match, which would otherwise leave "style" behind.
    .replace(/\bnigerian[-–—]?\s*style\b/gi, ' ')
    .replace(/\bnigerian\b/gi, ' ')
    // Separators orphaned by the removal: "X (Nigerian)" leaves empty
    // brackets, "Nigerian - Suya" leaves a dangling dash.
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s[-–—]\s/g, ' ')
    .replace(/^\s*[-–—]\s*|\s*[-–—]\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.length > 0 ? stripped : mealName.trim();
}

export const offerKey = (placeId: string, query: string): string =>
  `${placeId}:${query.trim().toLowerCase()}`;

// ── The request log ──────────────────────────────────────────────────────

export const CALL_KINDS = ['autocomplete', 'search'] as const;
export type ChowdeckCallKind = (typeof CALL_KINDS)[number];

/**
 * Who caused the call. The console filters on this: "are cooks or are we the
 * ones hammering them" is the first question when the numbers look wrong.
 */
export const CALL_TRIGGERS = ['user', 'admin', 'job', 'replay'] as const;
export type ChowdeckCallTrigger = (typeof CALL_TRIGGERS)[number];

/**
 *   ok            — 2xx and it parsed
 *   http_error    — they answered with a non-2xx
 *   timeout       — nothing within the timeout
 *   network_error — never reached them
 *   parse_error   — 2xx, but not a shape we recognise
 *   refused       — we did not send it: our own limit, cap, breaker or flag
 */
export const CALL_STATUSES = [
  'ok',
  'http_error',
  'timeout',
  'network_error',
  'parse_error',
  'refused',
] as const;
export type ChowdeckCallStatus = (typeof CALL_STATUSES)[number];

export interface ChowdeckCallAttributes {
  _id: string;
  kind: ChowdeckCallKind;
  trigger: ChowdeckCallTrigger;
  /** The console user, the job's owner, or null for a cook. */
  actorId: string | null;
  /** The whole URL as sent. No secrets exist to leak — there is no key. */
  url: string;
  params: Record<string, string>;
  status: ChowdeckCallStatus;
  httpStatus: number | null;
  durationMs: number;
  /** Predictions or vendors, as counted before our own filtering. */
  resultCount: number | null;
  error: string | null;
  /**
   * The low-level reason a request never got an answer: ECONNREFUSED,
   * ENOTFOUND, ETIMEDOUT, UND_ERR_SOCKET. This is what separates "Chowdeck is
   * down" from "our network is" from "they are rate-limiting us" (which comes
   * back as a status code, with headers, instead).
   */
  errorCode: string | null;
  /** Exactly what we sent. No secrets exist to leak — there is no key. */
  requestHeaders: Record<string, string>;
  /**
   * Every header they sent back, verbatim. Retry-After, rate-limit counters,
   * the CDN's own headers (cf-ray, server) — the evidence for what a refusal
   * actually was.
   */
  responseHeaders: Record<string, string> | null;
  /** The body exactly as received, truncated past the cap below. */
  responseBody: string | null;
  responseBytes: number | null;
  truncated: boolean;
  /** Set on a replay: the call it repeated. */
  replayOf: string | null;
  requestId: string | null;
  createdAt: Date;
}

/** Enough for any real search response (the tuwo sample is 88KB) without letting one fill the collection. */
export const MAX_STORED_BODY_BYTES = 512 * 1024;

/** How long a call row lives. Long enough to compare this week with last. */
export const CALL_LOG_TTL_DAYS = 14;

const callSchema = new Schema<ChowdeckCallAttributes>(
  {
    _id: { type: String, default: () => newId('chowdeckCall') },
    kind: { type: String, required: true, enum: CALL_KINDS, index: true },
    trigger: { type: String, required: true, enum: CALL_TRIGGERS, index: true },
    actorId: { type: String, default: null },
    url: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, required: true, enum: CALL_STATUSES, index: true },
    httpStatus: { type: Number, default: null },
    durationMs: { type: Number, required: true, default: 0 },
    resultCount: { type: Number, default: null },
    error: { type: String, default: null },
    errorCode: { type: String, default: null },
    requestHeaders: { type: Schema.Types.Mixed, default: {} },
    responseHeaders: { type: Schema.Types.Mixed, default: null },
    responseBody: { type: String, default: null },
    responseBytes: { type: Number, default: null },
    truncated: { type: Boolean, required: true, default: false },
    replayOf: { type: String, default: null },
    requestId: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'chowdeck_calls',
  },
);

// Newest first, always — and the TTL rides on the same field.
callSchema.index({ createdAt: -1 });
callSchema.index({ createdAt: 1 }, { expireAfterSeconds: CALL_LOG_TTL_DAYS * 24 * 60 * 60 });
callSchema.index({ 'params.query': 1, createdAt: -1 });
callSchema.index({ 'params.address_id': 1, createdAt: -1 });

export type ChowdeckCallDocument = HydratedDocument<ChowdeckCallAttributes>;
export const ChowdeckCallModel = model<ChowdeckCallAttributes>('ChowdeckCall', callSchema);

// ── Clicks ───────────────────────────────────────────────────────────────

export interface ChowdeckClickAttributes {
  _id: string;
  vendorId: string;
  vendorName: string;
  productId: string | null;
  mealSlug: string | null;
  placeId: string | null;
  /** Where on the row it sat, 0-based. Tells us whether anyone scrolls. */
  position: number | null;
  /** `cook` or `order` — which decide mode sent them. */
  mode: string | null;
  /** Salted hash, as decide logs keep it. Counts repeat tappers; identifies nobody. */
  ipHash: string;
  url: string;
  createdAt: Date;
}

const clickSchema = new Schema<ChowdeckClickAttributes>(
  {
    _id: { type: String, default: () => newId('chowdeckClick') },
    vendorId: { type: String, required: true, index: true },
    vendorName: { type: String, required: true },
    productId: { type: String, default: null },
    mealSlug: { type: String, default: null, index: true },
    placeId: { type: String, default: null, index: true },
    position: { type: Number, default: null },
    mode: { type: String, default: null },
    ipHash: { type: String, required: true },
    url: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'chowdeck_clicks',
  },
);

clickSchema.index({ createdAt: -1 });

export type ChowdeckClickDocument = HydratedDocument<ChowdeckClickAttributes>;
export const ChowdeckClickModel = model<ChowdeckClickAttributes>('ChowdeckClick', clickSchema);
