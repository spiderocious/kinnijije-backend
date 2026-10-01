import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MealDocument } from '@features/meals/meals.model.js';
import { DEFAULT_RANKING_CONFIG, resolveRankingConfig } from '@lib/ranking/index.js';

import { rankCandidates } from '../decide.ranker.js';
import { MOODS, WEIGHTS, type DecideInput } from '../decide.types.js';

function ing(name: string) {
  return { catalogueId: null, name, quantity: null, unit: null, optional: false };
}

function meal(over: Partial<MealDocument> & { _id: string; name: string }): MealDocument {
  return {
    slug: over.name.toLowerCase().replace(/\s+/g, '-'),
    status: 'published',
    source: 'seed',
    cuisines: [],
    difficulty: 'easy',
    cookTimeMinutes: 30,
    serves: 2,
    whatMakesItGood: '',
    description: '',
    steps: [],
    ingredientKeys: [],
    heroIcon: null,
    createdBy: null,
    images: [],
    primaryImageId: null,
    ...over,
  } as unknown as MealDocument;
}

const input: DecideInput = {
  kitchenItems: ['Yam', 'Eggs'],
  kitchenSkipped: false,
  mood: MOODS.PROPER,
  weight: WEIGHTS.SOLID,
  minutes: 90,
  city: undefined,
  rejected: [],
};

describe('quality tiers', () => {
  /**
   * THE CASE THIS EXISTS FOR.
   *
   * "Boiled yam and salt" matches a yam-and-eggs kitchen perfectly, so on raw
   * score it beats "yam and egg sauce" every time. Quality is what stops a bare
   * version winning on reachability alone.
   */
  const minimal = meal({
    _id: 'm-minimal',
    name: 'Boiled Yam',
    slug: 'boiled-yam-minimal',
    quality: 'minimal',
    ingredients: [ing('Yam')],
  });

  const full = meal({
    _id: 'm-full',
    name: 'Yam and Egg Sauce',
    slug: 'yam-and-egg-sauce',
    quality: 'full',
    ingredients: [ing('Yam'), ing('Eggs'), ing('Tomatoes')],
  });

  it('ranks the proper dish above a bare one when both are reachable', () => {
    const out = rankCandidates([minimal, full], input, { config: DEFAULT_RANKING_CONFIG });
    assert.equal(out[0]?.meal._id, 'm-full', 'the full dish should win');
  });

  it('still offers the bare one when nothing better fits', () => {
    // Somebody with only yam: the minimal version is the honest answer.
    const out = rankCandidates([minimal, full], { ...input, kitchenItems: ['Yam'] }, {});
    assert.ok(out.some((c) => c.meal._id === 'm-minimal'));
  });

  it('treats a meal with no quality as full, so nothing needs backfilling', () => {
    const legacy = meal({ _id: 'm-legacy', name: 'Legacy Dish', ingredients: [ing('Yam')] });
    const tagged = meal({
      _id: 'm-tagged',
      name: 'Tagged Dish',
      slug: 'tagged-dish',
      quality: 'full',
      ingredients: [ing('Yam')],
    });
    const out = rankCandidates([legacy, tagged], { ...input, kitchenItems: ['Yam'] }, {});
    assert.equal(out[0]?.rank, out[1]?.rank, 'an untagged meal must rank as full');
  });

  it('collapses variants of the same dish into one row', () => {
    // A shortlist of six versions of yam is not a choice.
    const variants = [
      meal({ _id: 'v1', name: 'Yam A', slug: 'yam-a', variantOf: 'yam', ingredients: [ing('Yam')] }),
      meal({ _id: 'v2', name: 'Yam B', slug: 'yam-b', variantOf: 'yam', quality: 'simple', ingredients: [ing('Yam')] }),
      meal({ _id: 'v3', name: 'Yam C', slug: 'yam-c', variantOf: 'yam', quality: 'minimal', ingredients: [ing('Yam')] }),
    ];
    const out = rankCandidates(variants, { ...input, kitchenItems: ['Yam'] }, {});
    assert.equal(out.length, 1, 'only the best version of a dish should appear');
    assert.equal(out[0]?.meal._id, 'v1', 'and it should be the fullest one');
  });

  it('can be told not to collapse', () => {
    const variants = [
      meal({ _id: 'v1', name: 'Yam A', slug: 'yam-a', variantOf: 'yam', ingredients: [ing('Yam')] }),
      meal({ _id: 'v2', name: 'Yam B', slug: 'yam-b', variantOf: 'yam', ingredients: [ing('Yam')] }),
    ];
    const config = resolveRankingConfig({ collapseVariants: false });
    const out = rankCandidates(variants, { ...input, kitchenItems: ['Yam'] }, { config });
    assert.equal(out.length, 2);
  });
});

describe('resolveRankingConfig', () => {
  it('falls back whole when nothing is stored', () => {
    assert.deepEqual(resolveRankingConfig(null), DEFAULT_RANKING_CONFIG);
  });

  it('merges a partial change over the defaults', () => {
    // An operator tuning one number must not have to restate the other twenty.
    const config = resolveRankingConfig({ quality: { minimal: 0.1 } });
    assert.equal(config.quality.minimal, 0.1);
    assert.equal(config.quality.full, DEFAULT_RANKING_CONFIG.quality.full);
  });

  it('refuses a value outside its range rather than ranking to zero', () => {
    const config = resolveRankingConfig({ quality: { full: 999 } });
    assert.deepEqual(config, DEFAULT_RANKING_CONFIG);
  });

  it('survives junk', () => {
    assert.deepEqual(resolveRankingConfig('nonsense'), DEFAULT_RANKING_CONFIG);
    assert.deepEqual(resolveRankingConfig(42), DEFAULT_RANKING_CONFIG);
  });
});

describe('never suggest a meal they have nothing for', () => {
  // Both fixtures carry a `solid` term in the name, so the weight filter keeps
  // both and the assertions measure the match rule rather than that filter.
  const unrelated = meal({
    _id: 'm-unrelated',
    name: 'Rice and Fish Stew',
    slug: 'rice-fish-stew',
    ingredients: [ing('Catfish'), ing('Palm oil')],
  });
  const related = meal({
    _id: 'm-related',
    name: 'Yam Porridge',
    slug: 'yam-porridge',
    ingredients: [ing('Yam'), ing('Palm oil')],
  });


  it('drops a meal touching nothing the cook has', () => {
    // A suggestion with no overlap is a shopping list with a recipe attached.
    const out = rankCandidates([unrelated, related], { ...input, kitchenItems: ['Yam'] }, {});
    assert.ok(out.every((c) => c.meal._id !== 'm-unrelated'));
    assert.equal(out[0]?.meal._id, 'm-related');
  });

  it('keeps everything when they told us nothing', () => {
    // Note: both fixtures have distinct slugs, so variant collapsing does not
    // merge them and the count is a real assertion about the filter.
    // With an empty kitchen every score is zero, so the filter would leave
    // nothing at all — the rule has to stand down.
    const out = rankCandidates(
      [unrelated, related],
      { ...input, kitchenItems: [], kitchenSkipped: true },
      {},
    );
    assert.equal(out.length, 2);
  });

  it('returns nothing when the shortlist uses none of what they have', () => {
    /**
     * REVERSED, deliberately. This asserted the opposite — that a shortlist
     * using none of their ingredients beat an empty screen.
     *
     * In practice that produced the worse outcome: somebody who said they had
     * Milo was shown Quick Instant Pap with every ingredient missing, under a
     * model-written sentence about how well it suited them. A confident
     * recommendation for an uncookable dish costs more trust than an empty
     * state, and the empty state is not blank — the service turns it into
     * "nothing matched" with an offer to widen the time or add to the kitchen.
     *
     * The fallback still applies when they told us NOTHING, which the test
     * above this one pins.
     */
    const out = rankCandidates([unrelated], { ...input, kitchenItems: ['Beans'] }, {});
    assert.equal(out.length, 0, 'a confident wrong answer is worse than an honest empty one');
  });

  it('can be switched off from the config', () => {
    const config = resolveRankingConfig({ requireSomeMatch: false });
    const out = rankCandidates([unrelated, related], { ...input, kitchenItems: ['Yam'] }, { config });
    assert.equal(out.length, 2);
  });
});
