import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CATALOGUE_SIZE,
  decideOptions,
  OPTIONS_VERSION,
  POPULAR_ID_COUNT,
} from '../decide.options.js';

describe('the options payload', () => {
  const view = decideOptions();

  it('serves the whole catalogue, not a curated subset', () => {
    // The bug this replaces: a cook searching for spaghetti could not find it,
    // because each group was capped at a handful of items.
    assert.ok(CATALOGUE_SIZE > 400, `expected the full catalogue, got ${String(CATALOGUE_SIZE)}`);
  });

  it('includes pasta and noodles', () => {
    const names = view.kitchen.flatMap((g) => g.items.map((i) => i.label.toLowerCase()));
    assert.ok(names.some((n) => n.includes('spaghetti')), 'spaghetti must be findable');
    assert.ok(names.some((n) => n.includes('indomie') || n.includes('noodle')));
  });

  it('carries aliases, so search matches what a cook types', () => {
    const all = view.kitchen.flatMap((g) => g.items);
    const withAliases = all.filter((i) => (i.aliases?.length ?? 0) > 0);
    assert.ok(withAliases.length > 100, 'most items should carry their local names');
  });

  it('leads with Popular, then the groups that decide a meal', () => {
    assert.equal(view.kitchen[0]?.id, 'popular');
    assert.equal(view.kitchen[1]?.id, 'grain');
  });

  it('has a stable version fingerprint', () => {
    assert.match(OPTIONS_VERSION, /^[0-9a-f]{12}$/);
    // Same content, same hash — otherwise every deploy would evict every cache.
    assert.equal(decideOptions().version, OPTIONS_VERSION);
  });

  it('stays small enough to send on a slow connection', () => {
    const bytes = Buffer.byteLength(JSON.stringify(view));
    assert.ok(bytes < 200_000, `payload is ${String(bytes)} bytes — too big to send eagerly`);
  });
});

describe('the Popular group', () => {
  const view = decideOptions();
  const popular = view.kitchen[0];

  it('leads the kitchen screen', () => {
    // The common case should be one tap, not a scroll through 26 categories.
    assert.equal(popular?.id, 'popular');
    assert.equal(popular?.label, 'Popular');
  });

  it('resolves every id it names', () => {
    // A typo in POPULAR_IDS silently drops a tile rather than failing, so the
    // count is asserted against the list's own length.
    assert.equal(popular?.items.length, POPULAR_ID_COUNT, 'an id in POPULAR_IDS no longer exists');
  });

  it('carries the staples a Nigerian kitchen actually has', () => {
    const labels = (popular?.items ?? []).map((i) => i.label.toLowerCase()).join(' ');
    for (const staple of ['rice', 'beans', 'yam', 'plantain', 'tomato', 'onion', 'garri']) {
      assert.ok(labels.includes(staple), `Popular is missing ${staple}`);
    }
  });

  it('keeps popular items in their own groups too', () => {
    // Somebody browsing "Grains" should still find rice there.
    const grains = view.kitchen.find((g) => g.id === 'grain');
    assert.ok(grains?.items.some((i) => i.label.toLowerCase().includes('rice')));
  });
});
