import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MealDocument } from '@features/meals/meals.model.js';

import { templatedFraming, templatedWhy } from '../decide.copy.js';
import { rankCandidates } from '../decide.ranker.js';
import { MOODS, WEIGHTS, type DecideInput } from '../decide.types.js';

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
    ingredients: [],
    steps: [],
    ingredientKeys: [],
    heroIcon: null,
    createdBy: null,
    images: [],
    primaryImageId: null,
    ...over,
  } as unknown as MealDocument;
}

const order: DecideInput = {
  kitchenItems: [],
  kitchenSkipped: true,
  mood: MOODS.FAST,
  weight: WEIGHTS.RICE,
  minutes: 15,
  city: undefined,
  rejected: [],
  mode: 'order',
};

describe('order mode ranking', () => {
  it('ignores the cook-time ceiling', () => {
    const slow = meal({ _id: 'm1', name: 'Ofada Rice', cookTimeMinutes: 120 });
    const out = rankCandidates([slow], order);
    assert.equal(out[0]?.meal._id, 'm1');
  });

  it('prefers the full dish over pared-back versions', () => {
    const full = meal({ _id: 'full', name: 'Jollof Rice' });
    const minimal = meal({ _id: 'min', name: 'Plain Rice', quality: 'minimal' });
    const out = rankCandidates([minimal, full], order);
    assert.deepEqual(out.map((c) => c.meal._id), ['full']);
  });

  it('nudges meals already known to be orderable nearby', () => {
    const a = meal({ _id: 'a', name: 'Coconut Rice' });
    const b = meal({ _id: 'b', name: 'Jollof Rice' });
    const out = rankCandidates([a, b], order, { orderable: new Set(['jollof rice']) });
    assert.equal(out[0]?.meal._id, 'b');
  });

  it('leaves cook mode untouched when no mode is sent', () => {
    const slow = meal({ _id: 'm1', name: 'Ofada Rice', cookTimeMinutes: 120 });
    const { mode: _mode, ...cook } = order;
    assert.equal(rankCandidates([slow], cook).length, 0);
  });
});

describe('order mode copy', () => {
  const candidate = {
    meal: meal({ _id: 'm', name: 'Jollof Rice', cookTimeMinutes: 45 }),
    score: 0,
    rank: 1,
    ingredients: [],
    have: [],
    missing: ['rice', 'tomatoes'],
    low: [],
    pantry: [],
  };

  it('never mentions cooking, minutes or shopping', () => {
    const why = templatedWhy(candidate, order);
    assert.doesNotMatch(why, /minute|pick up|kitchen/i);
  });

  it('frames the verdict for somebody ordering in', () => {
    assert.equal(templatedFraming(order, candidate), 'Put the pots away.');
  });
});
