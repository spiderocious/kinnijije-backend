import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { StoredVendor } from '../chowdeck.model.js';
import {
  adjustedRating,
  areaSlug,
  cleanText,
  formatClock,
  normaliseVendors,
  openState,
  rankOffers,
  storeUrl,
} from '../chowdeck.offers.js';

/** The real tuwo search from docs/, so a change in how we read it shows up here. */
const sample = JSON.parse(
  readFileSync(new URL('../../../../docs/restaurant-api.response.json', import.meta.url), 'utf8'),
) as { data: unknown[] };

/** A Lagos wall-clock time, as the UTC instant it is. Lagos is UTC+1. */
const lagos = (iso: string): Date => new Date(`${iso}+01:00`);

function vendor(over: Partial<StoredVendor> = {}): StoredVendor {
  return {
    vendorId: 'v1',
    name: 'Iya Moria',
    slug: 'iya-moria',
    area: 'Surulere',
    logoUrl: null,
    coverUrl: null,
    rating: null,
    ratingCount: 0,
    deliveryFeeKobo: 70000,
    minDeliveryMinutes: 25,
    maxDeliveryMinutes: 35,
    distanceKm: 2,
    hours: { default: { opening: '0900', closing: '2200', isOpen: true } },
    temporarilyUnavailable: false,
    unavailableReason: null,
    openAtFetch: true,
    products: [
      {
        productId: 'p1',
        name: 'Tuwo',
        description: null,
        priceKobo: 50000,
        priceDescription: 'per plate',
        inStock: true,
        imageUrl: null,
      },
    ],
    ...over,
  };
}

describe('normaliseVendors on the real sample', () => {
  const { vendors, dropped } = normaliseVendors(sample.data);

  it('reads every vendor', () => {
    assert.equal(dropped, 0);
    assert.equal(vendors.length, sample.data.length);
  });

  it('cleans their names', () => {
    const names = vendors.flatMap((v) => v.products.map((p) => p.name));
    assert.ok(names.every((n) => n === n.trim() && !n.includes('\t')));
    assert.ok(names.includes('Tuwo+ Ewedu & Gbegiri'));
  });

  it('keeps prices in kobo', () => {
    const first = vendors[0];
    assert.equal(first?.products[0]?.priceKobo, 50000);
    assert.equal(first?.deliveryFeeKobo, 70000);
  });

  it('prefers the lowercase day that carries is_open', () => {
    const first = vendors[0];
    assert.equal(first?.hours['saturday']?.isOpen, false);
    assert.equal(first?.hours['monday']?.opening, '2015');
  });
});

describe('store URLs', () => {
  it('hyphenates the area', () => {
    assert.equal(areaSlug('Ijesha Tedo'), 'ijesha-tedo');
    assert.equal(areaSlug('  Fola Agoro '), 'fola-agoro');
  });

  it('builds the restaurant page', () => {
    assert.equal(
      storeUrl('https://chowdeck.com/', { area: 'Ijesha Tedo', slug: 'tuwo-best-bankolemohijesha-tedotn6s3d' }),
      'https://chowdeck.com/store/ijesha-tedo/restaurants/tuwo-best-bankolemohijesha-tedotn6s3d',
    );
  });
});

describe('openState', () => {
  it('is open inside the hours, Lagos time', () => {
    assert.equal(openState(vendor(), lagos('2026-09-30T12:00:00')).open, true);
  });

  it('says when it opens later today', () => {
    const state = openState(vendor(), lagos('2026-09-30T07:30:00'));
    assert.deepEqual(state, { open: false, opensAt: '9am' });
  });

  it('is closed for the day after closing', () => {
    assert.deepEqual(openState(vendor(), lagos('2026-09-30T22:30:00')), { open: false, opensAt: null });
  });

  it('reads a 0000 closing as midnight', () => {
    const late = vendor({ hours: { default: { opening: '1800', closing: '0000', isOpen: true } } });
    assert.equal(openState(late, lagos('2026-09-30T23:30:00')).open, true);
  });

  it('handles hours past midnight', () => {
    const night = vendor({ hours: { default: { opening: '2000', closing: '0200', isOpen: true } } });
    assert.equal(openState(night, lagos('2026-09-30T01:00:00')).open, true);
    assert.equal(openState(night, lagos('2026-09-30T12:00:00')).open, false);
  });

  it('respects a day marked closed', () => {
    // 2026-10-03 is a Saturday.
    const v = vendor({
      hours: {
        default: { opening: '0900', closing: '2200', isOpen: true },
        saturday: { opening: '0000', closing: '0000', isOpen: false },
      },
    });
    assert.equal(openState(v, lagos('2026-10-03T12:00:00')).open, false);
  });

  it('is never open while paused', () => {
    assert.equal(openState(vendor({ temporarilyUnavailable: true }), lagos('2026-09-30T12:00:00')).open, false);
  });
});

describe('formatClock', () => {
  it('drops zero minutes', () => {
    assert.equal(formatClock(20 * 60), '8pm');
    assert.equal(formatClock(20 * 60 + 15), '8:15pm');
    assert.equal(formatClock(0), '12am');
  });
});

describe('adjustedRating', () => {
  it('pulls a thin rating toward the prior', () => {
    assert.ok(adjustedRating(2.5, 2) > 3);
    assert.ok(adjustedRating(4.8, 400) > 4.7);
  });
});

describe('rankOffers', () => {
  const noon = lagos('2026-09-30T12:00:00');

  it('drops out-of-stock products and restaurants shut for the day', () => {
    const soldOut = vendor().products.map((p) => ({ ...p, inStock: false }));
    const out = rankOffers(
      [
        vendor({ vendorId: 'a', name: 'A', products: soldOut }),
        vendor({ vendorId: 'b', name: 'B', hours: { default: { opening: '0600', closing: '0800', isOpen: true } } }),
        vendor({ vendorId: 'c', name: 'C' }),
      ],
      noon,
    );
    assert.deepEqual(out.open.map((o) => o.vendor.id), ['c']);
    assert.equal(out.later.length, 0);
    assert.equal(out.considered, 3);
  });

  it('puts later-today restaurants in their own list', () => {
    const out = rankOffers(
      [vendor({ vendorId: 'late', name: 'Late', hours: { default: { opening: '1800', closing: '2300', isOpen: true } } })],
      noon,
    );
    assert.equal(out.open.length, 0);
    assert.equal(out.later[0]?.vendor.opens_at, '6pm');
  });

  it('folds branches of one brand together', () => {
    const out = rankOffers(
      [
        vendor({ vendorId: 'd1', name: 'Dami Dreams', distanceKm: 5 }),
        vendor({ vendorId: 'd2', name: 'dami  dreams', distanceKm: 4 }),
      ],
      noon,
    );
    assert.equal(out.open.length, 1);
    assert.equal(out.open[0]?.vendor.id, 'd2');
  });

  it('ranks faster delivery first, then rating', () => {
    const out = rankOffers(
      [
        vendor({ vendorId: 'slow', name: 'Slow', maxDeliveryMinutes: 60, rating: 5, ratingCount: 500 }),
        vendor({ vendorId: 'fast', name: 'Fast', maxDeliveryMinutes: 30 }),
        vendor({ vendorId: 'fastgood', name: 'Fast Good', maxDeliveryMinutes: 30, rating: 4.9, ratingCount: 300 }),
      ],
      noon,
    );
    assert.deepEqual(out.open.map((o) => o.vendor.id), ['fastgood', 'fast', 'slow']);
  });

  it('converts kobo to naira and builds the go path', () => {
    const offer = rankOffers([vendor()], noon).open[0];
    assert.equal(offer?.product.price_naira, 500);
    assert.equal(offer?.vendor.delivery_fee_naira, 700);
    assert.equal(offer?.go_path, '/go/chowdeck/v1?product=p1');
  });
});

describe('cleanText', () => {
  it('collapses tabs and spaces', () => {
    assert.equal(cleanText('\tTuwo+  Ewedu '), 'Tuwo+ Ewedu');
    assert.equal(cleanText(null), '');
  });
});
