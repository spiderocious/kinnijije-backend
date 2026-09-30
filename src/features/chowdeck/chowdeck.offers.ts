import {
  ChowdeckProductSchema,
  ChowdeckVendorSchema,
  type ChowdeckVendor,
} from './chowdeck.contracts.js';
import type { StoredHours, StoredProduct, StoredVendor } from './chowdeck.model.js';

/**
 * Everything about an offer that is a pure function of data.
 *
 * No database, no network, no clock except the one passed in — so what a
 * cook sees for a given cache row at a given minute is testable, and the
 * console can show exactly the same answer the app would.
 */

// ── Normalising their response ───────────────────────────────────────────

/** Their names arrive with tabs and trailing spaces: '\tTuwo+ Ewedu & Gbegiri', 'tuwo '. */
export function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** 'tuwo' → 'Tuwo'. Only the first letter: 'Tuwo+ Ewedu & Gbegiri' is already how they wrote it. */
function capitaliseFirst(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

const nonNegative = (n: number | null | undefined): number | null =>
  n === null || n === undefined || n < 0 ? null : n;

function toStoredHours(raw: ChowdeckVendor['available_hours']): Record<string, StoredHours> {
  const out: Record<string, StoredHours> = {};
  if (raw === null || raw === undefined) return out;

  for (const [day, hours] of Object.entries(raw)) {
    // They send both 'monday' and 'Monday'. The lowercase one carries `is_open`,
    // so it wins; a capitalised key only fills a gap.
    const key = day.toLowerCase();
    const isCanonical = day === key;
    if (!isCanonical && out[key] !== undefined) continue;

    out[key] = {
      opening: hours.opening ?? null,
      closing: hours.closing ?? null,
      // Absent means open: the capitalised copies omit it entirely.
      isOpen: hours.is_open !== false,
    };
  }
  return out;
}

function toStoredProduct(raw: unknown): StoredProduct | null {
  const parsed = ChowdeckProductSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;

  const name = capitaliseFirst(cleanText(p.name));
  if (name.length === 0) return null;

  const description = cleanText(p.description);

  return {
    productId: p.id,
    name,
    // "Tuwo" described as "Tuwo" is not a description.
    description:
      description.length === 0 || description.toLowerCase() === name.toLowerCase()
        ? null
        : description,
    priceKobo: Math.max(0, Math.round(p.price)),
    priceDescription: cleanText(p.price_description) || null,
    inStock: p.in_stock === true && p.is_published !== false && p.is_active !== false,
    imageUrl: p.images?.[0]?.path ?? null,
  };
}

/**
 * The raw `data` array → what we cache.
 *
 * One vendor at a time, so a single odd restaurant is dropped and counted
 * rather than failing the whole search. The count is kept with the cache row:
 * a steady non-zero there is the first sign that their shape has moved.
 */
export function normaliseVendors(data: readonly unknown[]): {
  vendors: StoredVendor[];
  dropped: number;
} {
  const vendors: StoredVendor[] = [];
  let dropped = 0;

  for (const raw of data) {
    const parsed = ChowdeckVendorSchema.safeParse(raw);
    if (!parsed.success) {
      dropped += 1;
      continue;
    }
    const v = parsed.data;

    vendors.push({
      vendorId: v.id,
      name: cleanText(v.name),
      slug: v.slug.trim(),
      area: cleanText(v.location),
      logoUrl: v.logo_url ?? null,
      coverUrl: v.cover_images?.[0]?.path ?? null,
      // Zero ratings is reported as rating 0 by some vendors; that is "none".
      rating: (v.number_of_rating ?? 0) > 0 ? (v.average_rating ?? null) : null,
      ratingCount: Math.max(0, Math.round(v.number_of_rating ?? 0)),
      deliveryFeeKobo: nonNegative(v.delivery_price),
      minDeliveryMinutes: nonNegative(v.minimum_delivery_time),
      maxDeliveryMinutes: nonNegative(v.maximum_delivery_time),
      distanceKm: nonNegative(v.distance),
      hours: toStoredHours(v.available_hours),
      temporarilyUnavailable: v.is_temporarily_unavailable === true,
      unavailableReason: v.is_temporarily_unavailable === true
        ? cleanText(v.temporarily_unavailable_tag) || null
        : null,
      openAtFetch:
        v.current_is_open_state === null || v.current_is_open_state === undefined
          ? (v.is_open ?? null)
          : v.current_is_open_state === 1,
      products: v.products
        .map(toStoredProduct)
        .filter((p): p is StoredProduct => p !== null),
    });
  }

  return { vendors, dropped };
}

// ── Their URLs ───────────────────────────────────────────────────────────

/** "Ijesha Tedo" → "ijesha-tedo". Lowercase, hyphenated, nothing else. */
export function areaSlug(area: string): string {
  return area
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The restaurant's page on Chowdeck.
 *
 * Built from stored fields only, never from anything a client sent — the
 * redirect that uses this must not become an open redirect.
 */
export function storeUrl(webBase: string, vendor: Pick<StoredVendor, 'area' | 'slug'>): string {
  const base = webBase.replace(/\/+$/, '');
  return `${base}/store/${areaSlug(vendor.area)}/restaurants/${encodeURIComponent(vendor.slug)}`;
}

// ── Opening hours ────────────────────────────────────────────────────────

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/**
 * Lagos is UTC+1 all year — no daylight saving — so a fixed offset is exact
 * and avoids depending on the server's timezone database.
 */
const LAGOS_OFFSET_MINUTES = 60;

export function lagosClock(now: Date): { day: (typeof DAYS)[number]; minutes: number } {
  const shifted = new Date(now.getTime() + LAGOS_OFFSET_MINUTES * 60_000);
  return {
    day: DAYS[shifted.getUTCDay()] ?? 'monday',
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** "2015" → 1215. Null for anything that is not four digits. */
function hhmmToMinutes(value: string | null): number | null {
  if (value === null || !/^\d{4}$/.test(value)) return null;
  const h = Number(value.slice(0, 2));
  const m = Number(value.slice(2));
  if (h > 24 || m > 59) return null;
  return h * 60 + m;
}

/** 1215 → "8:15pm", 1200 → "8pm". */
export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${String(h12)}${suffix}` : `${String(h12)}:${String(m).padStart(2, '0')}${suffix}`;
}

export interface OpenState {
  open: boolean;
  /** "8pm" when it opens later today. Null when open, closed all day, or unknown. */
  opensAt: string | null;
}

/**
 * Open right now, worked out from the weekly hours.
 *
 * Computed at READ time, never cached: a cached "open" goes stale within
 * minutes, and their own `is_open` in the sample already disagrees with their
 * `current_is_open_state`. The hours are the one thing that stays true for a
 * whole day.
 *
 * With no usable hours at all, falls back to their flag at fetch time, and
 * then to open — hiding a restaurant because we could not read its hours
 * would be our failure presented as theirs.
 */
export function openState(
  vendor: Pick<StoredVendor, 'hours' | 'openAtFetch' | 'temporarilyUnavailable'>,
  now: Date,
): OpenState {
  if (vendor.temporarilyUnavailable) return { open: false, opensAt: null };

  const { day, minutes } = lagosClock(now);
  const today = vendor.hours[day] ?? vendor.hours.default;
  if (today === undefined) return { open: vendor.openAtFetch ?? true, opensAt: null };
  if (!today.isOpen) return { open: false, opensAt: null };

  const opening = hhmmToMinutes(today.opening);
  let closing = hhmmToMinutes(today.closing);
  if (opening === null || closing === null) return { open: vendor.openAtFetch ?? true, opensAt: null };

  // "0000" as a closing time means midnight at the END of the day.
  if (closing === 0) closing = 24 * 60;

  // Open all day, as some vendors state it.
  if (opening === closing) return { open: true, opensAt: null };

  const open =
    closing > opening
      ? minutes >= opening && minutes < closing
      : // Past midnight: 1800 → 0200 is open late evening and early morning.
        minutes >= opening || minutes < closing;

  if (open) return { open: true, opensAt: null };
  return { open: false, opensAt: minutes < opening ? formatClock(opening) : null };
}

// ── Ranking ──────────────────────────────────────────────────────────────

/**
 * Rating, pulled toward a prior until there are enough ratings to trust.
 *
 * Two ratings of 2.5 is not a 2.5-star restaurant; it is two people. With
 * PRIOR_WEIGHT ratings' worth of "average", a place needs a real number of
 * votes before its own score dominates.
 */
const PRIOR_RATING = 3.8;
const PRIOR_WEIGHT = 5;

export function adjustedRating(rating: number | null, count: number): number {
  if (rating === null || count <= 0) return PRIOR_RATING;
  return (PRIOR_RATING * PRIOR_WEIGHT + rating * count) / (PRIOR_WEIGHT + count);
}

/**
 * Delivery time in ten-minute bands. Exact minutes would let 27 beat 29 on
 * noise, and then rating would never get a say.
 */
const deliveryBand = (v: StoredVendor): number =>
  v.maxDeliveryMinutes === null ? Number.MAX_SAFE_INTEGER : Math.ceil(v.maxDeliveryMinutes / 10);

/** Two branches of the same kitchen are one choice, not two. */
const brandKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface OfferView {
  /** `${vendorId}:${productId}` — stable across refetches while both exist. */
  id: string;
  vendor: {
    id: string;
    name: string;
    area: string;
    logo_url: string | null;
    cover_url: string | null;
    rating: number | null;
    rating_count: number;
    delivery_fee_naira: number | null;
    delivery_minutes: { min: number; max: number } | null;
    distance_km: number | null;
    open_now: boolean;
    opens_at: string | null;
  };
  product: {
    id: string;
    name: string;
    description: string | null;
    price_naira: number;
    price_description: string | null;
    image_url: string | null;
    /** Other in-stock matches at the same restaurant. */
    more_count: number;
  };
  /**
   * Relative to the API root. The client adds meal, place, position and mode;
   * the server resolves the destination itself.
   */
  go_path: string;
}

export interface RankedOffers {
  /** Open now, best first. */
  open: OfferView[];
  /** Opens later today — shown smaller, never mixed with the open ones. */
  later: OfferView[];
  /** Everything in the cache row, for the console: how much the filter removed. */
  considered: number;
}

interface Scored {
  vendor: StoredVendor;
  product: StoredProduct;
  more: number;
  state: OpenState;
  rating: number;
}

const kobo = (value: number): number => Math.round(value) / 100;

function toView(s: Scored): OfferView {
  const { vendor, product } = s;
  const hasTime = vendor.minDeliveryMinutes !== null && vendor.maxDeliveryMinutes !== null;

  return {
    id: `${vendor.vendorId}:${product.productId}`,
    vendor: {
      id: vendor.vendorId,
      name: vendor.name,
      area: vendor.area,
      logo_url: vendor.logoUrl,
      cover_url: vendor.coverUrl,
      rating: vendor.rating === null ? null : Math.round(vendor.rating * 10) / 10,
      rating_count: vendor.ratingCount,
      delivery_fee_naira: vendor.deliveryFeeKobo === null ? null : kobo(vendor.deliveryFeeKobo),
      delivery_minutes: hasTime
        ? { min: vendor.minDeliveryMinutes ?? 0, max: vendor.maxDeliveryMinutes ?? 0 }
        : null,
      distance_km: vendor.distanceKm === null ? null : Math.round(vendor.distanceKm * 10) / 10,
      open_now: s.state.open,
      opens_at: s.state.opensAt,
    },
    product: {
      id: product.productId,
      name: product.name,
      description: product.description,
      price_naira: kobo(product.priceKobo),
      price_description: product.priceDescription,
      image_url: product.imageUrl,
      more_count: s.more,
    },
    go_path: `/go/chowdeck/${encodeURIComponent(vendor.vendorId)}?product=${encodeURIComponent(product.productId)}`,
  };
}

const compare = (a: Scored, b: Scored): number => {
  if (a.state.open !== b.state.open) return a.state.open ? -1 : 1;
  const band = deliveryBand(a.vendor) - deliveryBand(b.vendor);
  if (band !== 0) return band;
  if (b.rating !== a.rating) return b.rating - a.rating;
  if (a.product.priceKobo !== b.product.priceKobo) return a.product.priceKobo - b.product.priceKobo;
  const da = a.vendor.distanceKm ?? Number.MAX_SAFE_INTEGER;
  const db = b.vendor.distanceKm ?? Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  return a.vendor.vendorId.localeCompare(b.vendor.vendorId);
};

/**
 * Cached vendors → what a cook sees, at this moment.
 *
 * In order: drop what cannot be ordered (out of stock, paused, closed for the
 * day), fold branches of one brand together, then open-now first, delivery
 * band, adjusted rating, price, distance. Deterministic, so a refresh does not
 * reshuffle the row.
 */
export function rankOffers(vendors: readonly StoredVendor[], now: Date): RankedOffers {
  const scored: Scored[] = [];

  for (const vendor of vendors) {
    const inStock = vendor.products.filter((p) => p.inStock);
    const product = inStock[0];
    if (product === undefined) continue;

    const state = openState(vendor, now);
    // Paused, or shut for the whole day: nothing a cook can act on tonight.
    if (!state.open && state.opensAt === null) continue;

    scored.push({
      vendor,
      product,
      more: inStock.length - 1,
      state,
      rating: adjustedRating(vendor.rating, vendor.ratingCount),
    });
  }

  scored.sort(compare);

  const seen = new Set<string>();
  const unique = scored.filter((s) => {
    const key = brandKey(s.vendor.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    open: unique.filter((s) => s.state.open).map(toView),
    later: unique.filter((s) => !s.state.open).map(toView),
    considered: vendors.length,
  };
}
