import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { refusesPromotion } from '../decide.service.js';

/**
 * The model promoting a meal somebody cannot cook.
 *
 * Holding noodles, plantain and rice, the ranker put White Rice first —
 * everything in the kitchen, nothing to buy. The model moved Indomie and Egg
 * above it because twelve minutes beat twenty-five, ignoring that the noodles
 * needed eggs and onions the person did not have.
 *
 * A faster cook time is worth nothing if it costs a trip to the market, and a
 * prompt alone is too soft a guarantee for that — hence this guard.
 */
const ready = { missing: [] as string[] };
const needsOne = { missing: ['Eggs'] };
const needsTwo = { missing: ['Eggs', 'Red onions'] };

describe('refusesPromotion', () => {
  it('refuses a pick that sends them shopping when the leader does not', () => {
    // The reported case, exactly.
    assert.equal(refusesPromotion(ready, needsTwo), true);
  });

  it('refuses even when only one ingredient is missing', () => {
    // There is no acceptable amount of shopping when dinner is already in the
    // house — one missing ingredient is still a trip out.
    assert.equal(refusesPromotion(ready, needsOne), true);
  });

  it('allows the promotion when the leader also needs something', () => {
    // Neither is cookable right now, so the model's judgement on mood and
    // taste is the better signal and it keeps its say.
    assert.equal(refusesPromotion(needsOne, needsTwo), false);
  });

  it('allows a swap between two ready meals', () => {
    // Both cookable now: this is precisely the choice the model exists to
    // make, and nothing is lost whichever it picks.
    assert.equal(refusesPromotion(ready, { missing: [] }), false);
  });

  it('stands down when the model named nothing we offered', () => {
    // `findIndex` returns -1 and the caller passes undefined. Falling back to
    // the leader is handled elsewhere; this must not throw.
    assert.equal(refusesPromotion(ready, undefined), false);
  });

  it('stands down when there are no candidates at all', () => {
    assert.equal(refusesPromotion(undefined, undefined), false);
  });
});
