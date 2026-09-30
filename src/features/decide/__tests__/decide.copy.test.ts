import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MealDocument } from '@features/meals/meals.model.js';

import { haveFraction, hookLine, templatedWhy } from '../decide.copy.js';
import { MOODS, WEIGHTS, type DecideCandidate, type DecideInput } from '../decide.types.js';

function candidate(over: Partial<DecideCandidate> = {}): DecideCandidate {
  return {
    meal: {
      _id: 'm1',
      name: 'Jollof Rice',
      cookTimeMinutes: 45,
      difficulty: 'easy',
    } as unknown as MealDocument,
    score: 0.5,
    rank: 0.5,
    ingredients: [],
    have: [],
    missing: [],
    low: [],
    pantry: [],
    ...over,
  };
}

const input: DecideInput = {
  kitchenItems: [],
  kitchenSkipped: false,
  mood: MOODS.FAST,
  weight: WEIGHTS.RICE,
  minutes: 40,
  city: undefined,
  rejected: [],
};

describe('haveFraction', () => {
  it('counts have against have + missing', () => {
    const f = haveFraction(candidate({ have: ['rice', 'oil'], missing: ['salt'] }));
    assert.deepEqual(f, { have: 2, total: 3 });
  });
});

describe('templatedWhy', () => {
  it('never names an ingredient the cook does not have', () => {
    // The one error that would destroy trust in the whole screen.
    const why = templatedWhy(candidate({ have: [], missing: ['atarodo', 'iru'] }), input);
    assert.ok(!why.includes('already in your kitchen'));
  });

  it('names what they do have', () => {
    const why = templatedWhy(candidate({ have: ['rice'], missing: ['salt'] }), input);
    assert.ok(why.includes('rice'));
  });

  it('says so when they have everything', () => {
    const why = templatedWhy(candidate({ have: ['rice', 'oil'], missing: [] }), input);
    assert.ok(why.includes('everything'));
  });

  it('always states the cook time', () => {
    assert.ok(templatedWhy(candidate(), input).includes('45 minutes'));
  });

  it('carries no exclamation mark', () => {
    // The voice rule that separates warm from perky.
    for (const mood of [MOODS.TIRED, MOODS.FAST, MOODS.PROPER, MOODS.COMFORT]) {
      const why = templatedWhy(candidate({ have: ['rice'] }), { ...input, mood });
      assert.ok(!why.includes('!'), `"${why}" must not shout`);
    }
  });

  it('starts with a capital', () => {
    assert.match(templatedWhy(candidate(), input), /^[A-Z]/);
  });
});

describe('hookLine', () => {
  it('leads with everything when nothing is missing', () => {
    assert.equal(hookLine(candidate({ have: ['a', 'b'], missing: [] }), false), 'You have everything.');
  });

  it('states the fraction when partly stocked', () => {
    assert.equal(hookLine(candidate({ have: ['a'], missing: ['b', 'c'] }), false), 'You have 1 of 3.');
  });

  it('falls back to the shopping count', () => {
    assert.equal(hookLine(candidate({ have: [], missing: ['a', 'b'] }), false), 'Only 2 to buy.');
  });

  it('calls out the fastest when there is nothing better to say', () => {
    assert.equal(hookLine(candidate({ have: [], missing: ['a', 'b', 'c'] }), true), 'Fastest of the three.');
  });
});
