import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MealDocument } from '@features/meals/meals.model.js';

import {
  adaptKitchenToStock,
  ceilingFor,
  matchesWeight,
  rankCandidates,
  weatherMultiplier,
  timeOfDayMultiplier,
} from '../decide.ranker.js';
import { MOODS, WEIGHTS, type DecideInput } from '../decide.types.js';

/** A meal with only the fields the ranker reads. */
function meal(over: Partial<MealDocument> & { _id: string; name: string }): MealDocument {
  return {
    slug: over.name.toLowerCase().replace(/\s+/g, '-'),
    status: 'published',
    source: 'seed',
    cuisines: [],
    difficulty: 'easy',
    cookTimeMinutes: 30,
    serves: 4,
    whatMakesItGood: '',
    description: '',
    ingredients: [],
    steps: [],
    ingredientKeys: [],
    heroIcon: null,
    createdBy: null,
    ...over,
  } as unknown as MealDocument;
}

function ingredient(name: string, optional = false) {
  return { catalogueId: null, name, quantity: null, unit: null, optional };
}

const baseInput: DecideInput = {
  kitchenItems: [],
  kitchenSkipped: false,
  mood: MOODS.PROPER,
  weight: WEIGHTS.SOLID,
  minutes: 90,
  city: undefined,
  rejected: [],
};

describe('adaptKitchenToStock', () => {
  it('gives every tapped item a positive quantity', () => {
    // indexStock drops quantity <= 0, so a zero here would make everything the
    // person tapped read back as missing.
    const rows = adaptKitchenToStock(['Rice', 'Beans']);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.quantity > 0));
  });

  it('leaves the unit null so nothing is ever reported LOW', () => {
    const rows = adaptKitchenToStock(['Rice']);
    assert.equal(rows[0]?.unit, null);
  });

  it('de-duplicates case-insensitively, keeping the cook spelling', () => {
    const rows = adaptKitchenToStock(['Rice', 'rice', 'RICE']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.name, 'Rice');
  });

  it('drops blank entries', () => {
    assert.equal(adaptKitchenToStock(['', '   ', 'Yam']).length, 1);
  });

  it('resolves a catalogue id where the name is known', () => {
    const rows = adaptKitchenToStock(['rice']);
    assert.notEqual(rows[0]?.catalogueId, undefined);
  });
});

describe('ceilingFor', () => {
  it('tightens for a tired cook', () => {
    // Asserted as a RELATION, not a magic number: the exact proportion is a
    // tuning knob, and a test that pins it just has to be edited every time it
    // moves without ever catching a real fault.
    assert.ok(ceilingFor(MOODS.TIRED, 90) < 90);
  });
  it('tightens hardest for a hurry', () => {
    assert.ok(ceilingFor(MOODS.FAST, 90) < ceilingFor(MOODS.TIRED, 90));
  });
  it('never raises the budget the person chose', () => {
    assert.equal(ceilingFor(MOODS.TIRED, 15), 15);
    assert.equal(ceilingFor(MOODS.PROPER, 40), 40);
  });
});

describe('matchesWeight', () => {
  it('matches on the name', () => {
    assert.ok(matchesWeight(meal({ _id: 'm1', name: 'Jollof Rice' }), WEIGHTS.RICE));
  });
  it('matches on a cuisine tag', () => {
    assert.ok(
      matchesWeight(meal({ _id: 'm2', name: 'Something', cuisines: ['pepper soup'] }), WEIGHTS.SOUPY),
    );
  });
  it('does not match an unrelated meal', () => {
    assert.equal(matchesWeight(meal({ _id: 'm3', name: 'Puff Puff' }), WEIGHTS.SWALLOW), false);
  });
});

describe('weatherMultiplier', () => {
  const soup = meal({ _id: 's', name: 'Pepper Soup' });
  const swallow = meal({ _id: 'w', name: 'Amala' });

  it('is neutral with no reading', () => {
    assert.equal(weatherMultiplier(soup, null), 1);
  });
  it('down-weights heavy swallow in the heat', () => {
    assert.ok(weatherMultiplier(swallow, { temperature: 34, raining: false }) < 1);
  });
  it('up-weights soup in the rain', () => {
    assert.ok(weatherMultiplier(soup, { temperature: 26, raining: true }) > 1);
  });
});

describe('rankCandidates', () => {
  const meals = [
    meal({
      _id: 'm-jollof',
      name: 'Jollof Rice',
      cookTimeMinutes: 45,
      ingredients: [ingredient('rice'), ingredient('tomato'), ingredient('onion')],
    }),
    meal({
      _id: 'm-fried',
      name: 'Fried Rice',
      cookTimeMinutes: 20,
      ingredients: [ingredient('rice'), ingredient('carrot')],
    }),
    meal({
      _id: 'm-draft',
      name: 'Draft Rice',
      status: 'draft',
      ingredients: [ingredient('rice')],
    }),
    meal({
      _id: 'm-long',
      name: 'Slow Rice',
      cookTimeMinutes: 200,
      ingredients: [ingredient('rice')],
    }),
  ];

  it('never returns an unpublished meal', () => {
    const out = rankCandidates(meals, { ...baseInput, weight: WEIGHTS.RICE });
    assert.ok(out.every((c) => c.meal._id !== 'm-draft'));
  });

  it('drops anything over the time ceiling', () => {
    const out = rankCandidates(meals, { ...baseInput, weight: WEIGHTS.RICE, minutes: 40 });
    assert.ok(out.every((c) => c.meal.cookTimeMinutes <= 40));
  });

  it('excludes meals the person already refused', () => {
    const out = rankCandidates(meals, {
      ...baseInput,
      weight: WEIGHTS.RICE,
      rejected: ['m-jollof'],
    });
    assert.ok(out.every((c) => c.meal._id !== 'm-jollof'));
  });

  it('still answers with an empty kitchen', () => {
    const out = rankCandidates(meals, { ...baseInput, weight: WEIGHTS.RICE, kitchenItems: [] });
    assert.ok(out.length > 0, 'an empty kitchen must still produce candidates');
  });

  it('reports what the cook has', () => {
    const out = rankCandidates(meals, {
      ...baseInput,
      weight: WEIGHTS.RICE,
      kitchenItems: ['rice', 'tomato', 'onion'],
    });
    const jollof = out.find((c) => c.meal._id === 'm-jollof');
    assert.ok(jollof);
    assert.equal(jollof.missing.length, 0);
    assert.equal(jollof.score, 1);
  });

  it('never reports an ingredient as LOW on the anonymous path', () => {
    // A tapped item asserts presence, never quantity — so "low" is meaningless
    // here and its appearance would mean the adapter is wrong.
    const out = rankCandidates(meals, {
      ...baseInput,
      weight: WEIGHTS.RICE,
      kitchenItems: ['rice', 'tomato', 'onion', 'carrot'],
    });
    assert.ok(out.every((c) => c.low.length === 0));
  });

  it('puts the quickest first when in a hurry', () => {
    const out = rankCandidates(meals, {
      ...baseInput,
      weight: WEIGHTS.RICE,
      mood: MOODS.FAST,
      minutes: 90,
    });
    assert.equal(out[0]?.meal._id, 'm-fried');
  });

  it('falls back to the unfiltered pool when no meal carries the tag', () => {
    // An empty screen is a worse answer than a less-tagged one.
    const out = rankCandidates(meals, { ...baseInput, weight: WEIGHTS.STREET });
    assert.ok(out.length > 0);
  });

  it('is deterministic — the same draft yields the same order', () => {
    const input = { ...baseInput, weight: WEIGHTS.RICE, kitchenItems: ['rice'] };
    const a = rankCandidates(meals, input).map((c) => c.meal._id);
    const b = rankCandidates(meals, input).map((c) => c.meal._id);
    assert.deepEqual(a, b);
  });

  it('returns nothing when every candidate was refused', () => {
    const out = rankCandidates(meals, {
      ...baseInput,
      weight: WEIGHTS.RICE,
      rejected: ['m-jollof', 'm-fried', 'm-long', 'm-draft'],
    });
    assert.equal(out.length, 0);
  });

  it('honours the limit', () => {
    const out = rankCandidates(meals, { ...baseInput, weight: WEIGHTS.RICE }, { limit: 1 });
    assert.equal(out.length, 1);
  });
});

describe('the cook-time ceiling', () => {
  it('never rises above the budget the person chose', () => {
    // Asking for 15 minutes and being offered a 35-minute cook is the same
    // failure as the one below, in the opposite direction.
    for (const mood of [MOODS.TIRED, MOODS.FAST, MOODS.PROPER, MOODS.COMFORT]) {
      for (const minutes of [15, 40, 90] as const) {
        assert.ok(
          ceilingFor(mood, minutes) <= minutes,
          `${mood}/${String(minutes)} produced ${String(ceilingFor(mood, minutes))}`,
        );
      }
    }
  });

  it('never collapses to a window with almost nothing in it', () => {
    // THE REGRESSION. `fast` used to clamp to a flat 25 minutes, which left one
    // meal in the entire catalogue — so somebody asking for something solid in
    // forty minutes was handed a noodle stir-fry, because the weight filter
    // found nothing and fell back to the unfiltered pool.
    assert.ok(ceilingFor(MOODS.FAST, 40) >= 35, 'fast/40 must not strand the catalogue');
    assert.ok(ceilingFor(MOODS.TIRED, 40) >= 35, 'tired/40 must not strand the catalogue');
  });

  it('still prefers quicker for an impatient mood', () => {
    // The preference has to survive the fix, or mood stops meaning anything.
    assert.ok(ceilingFor(MOODS.FAST, 90) < 90);
    assert.ok(ceilingFor(MOODS.TIRED, 90) < 90);
    assert.equal(ceilingFor(MOODS.PROPER, 90), 90);
  });

  it('leaves a real choice at every mood and budget', () => {
    // A ceiling is only safe if meals actually exist under it.
    const times = [15, 20, 30, 35, 40, 45, 50, 55, 60, 70, 90];
    for (const mood of [MOODS.TIRED, MOODS.FAST, MOODS.PROPER, MOODS.COMFORT]) {
      for (const minutes of [40, 90] as const) {
        const under = times.filter((t) => t <= ceilingFor(mood, minutes)).length;
        assert.ok(under >= 3, `${mood}/${String(minutes)} leaves only ${String(under)} cook times`);
      }
    }
  });
});

/**
 * The "I have Milo" bug, in two parts.
 *
 * Somebody said they had Milo and was handed a pap recipe with every
 * ingredient missing, under a confident sentence about how well it suited
 * them. Two independent faults produced that one screen, so both are pinned
 * here: a meal that was wrongly filtered out, and a fallback that served the
 * pool it had just rejected.
 */
describe('the Milo regression', () => {
  const tea = meal({
    _id: 'm_tea',
    name: 'Nigerian Tea',
    description: 'Milo or Bournvita, hot water, milk.',
    cookTimeMinutes: 7,
    ingredients: [ingredient('Milo'), ingredient('Powdered milk')],
  });

  const pap = meal({
    _id: 'm_pap',
    name: 'Quick Instant Pap',
    description: 'Instant pap, hot water, milk.',
    cookTimeMinutes: 6,
    ingredients: [ingredient('Instant pap'), ingredient('Powdered milk')],
  });

  it('admits a drink as LIGHT', () => {
    // It was excluded before a single ingredient was compared: the haystack
    // read name, cuisines and description only, and none of them held a term
    // the `light` list knew about.
    assert.equal(matchesWeight(tea, WEIGHTS.LIGHT), true);
  });

  it('matches a meal on an ingredient the person actually has', () => {
    const out = rankCandidates([tea, pap], {
      ...baseInput,
      kitchenItems: ['Milo'],
      weight: WEIGHTS.LIGHT,
    });

    assert.equal(out.length, 1);
    assert.equal(out[0]?.meal.name, 'Nigerian Tea');
    assert.deepEqual(out[0]?.have, ['Milo']);
  });

  it('returns NOTHING rather than a shortlist that uses none of it', () => {
    // The old code fell back to the rejected pool, which is how a confident
    // recommendation for an uncookable dish reached the screen. Empty is the
    // honest answer; the service turns it into "nothing matched".
    const out = rankCandidates([tea, pap], {
      ...baseInput,
      kitchenItems: ['Goat meat'],
      weight: WEIGHTS.LIGHT,
    });

    assert.equal(out.length, 0);
  });

  it('still suggests something when the kitchen is empty', () => {
    // The guard must not fire here: with nothing stated every score is zero by
    // definition, and "the closest thing" is the correct reading.
    const out = rankCandidates([tea, pap], {
      ...baseInput,
      kitchenItems: [],
      weight: WEIGHTS.LIGHT,
    });

    assert.ok(out.length > 0);
  });
});

/**
 * Two complaints from the same session, both about ordering.
 *
 * "Why am I shown an egg recipe when I said I have rice" and "why is it
 * offering me tea at 3pm". Neither was a data problem — both were the ranker
 * treating every ingredient and every hour as equivalent.
 */
describe('staple weighting', () => {
  const eggs = meal({
    _id: 'm_eggs',
    name: 'Breakfast Eggs',
    cookTimeMinutes: 15,
    ingredients: [
      ingredient('Eggs'),
      ingredient('Sausage'),
      ingredient('Red onions'),
      ingredient('Tomatoes'),
      ingredient('Salt'),
    ],
  });

  const riceDish = meal({
    _id: 'm_rice',
    name: 'Coconut Rice',
    cookTimeMinutes: 33,
    ingredients: [
      ingredient('Long-grain rice'),
      ingredient('Coconut milk'),
      ingredient('Tomatoes'),
      ingredient('Salt'),
    ],
  });

  it('puts the meal using their staple above one matching only a seasoning', () => {
    // The reported bug: holding rice and salt, "Breakfast Eggs" (matched on
    // salt alone) came back above "Coconut Rice" (matched on the rice),
    // because a 15-minute cook time beat a better match.
    const out = rankCandidates([eggs, riceDish], {
      ...baseInput,
      kitchenItems: ['Long-grain rice', 'Salt'],
      mood: MOODS.FAST,
      weight: WEIGHTS.SOLID,
    });

    assert.equal(out[0]?.meal.name, 'Coconut Rice');
  });

  it('leaves a meal with no staple alone rather than penalising it', () => {
    // A soup or a drink has no backbone ingredient, and must not be pushed
    // down for lacking one.
    const soup = meal({
      _id: 'm_soup',
      name: 'Pepper Soup',
      ingredients: [ingredient('Goat meat'), ingredient('Pepper soup spice')],
    });
    const out = rankCandidates([soup], { ...baseInput, kitchenItems: ['Goat meat'] });
    assert.equal(out.length, 1);
  });
});

describe('timeOfDayMultiplier', () => {
  const tea = meal({ _id: 'm_tea', name: 'Nigerian Tea' });
  const stew = meal({ _id: 'm_stew', name: 'Beef Stew' });

  it('leaves breakfast alone in the morning', () => {
    assert.equal(timeOfDayMultiplier(tea, 8), 1);
  });

  it('pushes breakfast down in the afternoon', () => {
    // The complaint, exactly: tea at 3pm.
    assert.ok(timeOfDayMultiplier(tea, 15) < 1);
  });

  it('never touches a meal that is not breakfast', () => {
    assert.equal(timeOfDayMultiplier(stew, 15), 1);
  });

  it('does nothing when the hour is unknown', () => {
    assert.equal(timeOfDayMultiplier(tea, null), 1);
  });

  it('demotes rather than removes', () => {
    // A night worker eating pap at seven is a real person. The nudge must stay
    // a multiplier, never a filter.
    assert.ok(timeOfDayMultiplier(tea, 19) > 0);
  });

  it('does not read the description', () => {
    // "serve with tea" in a method would otherwise make a stew breakfast.
    const served = meal({ _id: 'm_x', name: 'Beef Stew', description: 'Lovely with tea.' });
    assert.equal(timeOfDayMultiplier(served, 15), 1);
  });
});

/**
 * "I have rice and beans, 15 minutes" → "Nothing quite fits".
 *
 * Forty meals fitted the time budget and none used rice or beans, so
 * `requireSomeMatch` emptied the shortlist and the screen said nothing
 * existed. The real obstacle was the CLOCK — rice takes twenty-five minutes —
 * and that is a completely different message from "we have nothing for you".
 */
describe('relaxing the clock before giving up', () => {
  const quickEgg = meal({
    _id: 'm_egg',
    name: 'Egg Sauce',
    cookTimeMinutes: 10,
    ingredients: [ingredient('Eggs'), ingredient('Tomatoes')],
  });

  const riceDish = meal({
    _id: 'm_rice',
    name: 'White Rice',
    cookTimeMinutes: 25,
    ingredients: [ingredient('Long-grain rice')],
  });

  it('offers the slower meal they CAN make rather than nothing', () => {
    // 25 minutes is over a 15-minute budget, but it is the only thing that
    // uses their rice — and "this takes a bit longer" beats "nothing fits".
    const out = rankCandidates([quickEgg, riceDish], {
      ...baseInput,
      kitchenItems: ['Long-grain rice'],
      mood: MOODS.FAST,
      minutes: 15,
    });

    assert.equal(out.length, 1);
    assert.equal(out[0]?.meal.name, 'White Rice');
  });

  it('still returns nothing when nothing uses any of it', () => {
    // The relaxed retry must not become a licence to serve meals that match
    // nothing — that is the "I have Milo, here is pap" failure.
    const out = rankCandidates([quickEgg, riceDish], {
      ...baseInput,
      kitchenItems: ['Aluminium foil'],
      mood: MOODS.FAST,
      minutes: 15,
    });

    assert.equal(out.length, 0);
  });

  it('does not relax when something already fits the budget', () => {
    // The fast path must stay untouched: a meal inside the budget wins, and
    // the slower one is not dragged in beside it.
    const out = rankCandidates([quickEgg, riceDish], {
      ...baseInput,
      kitchenItems: ['Eggs'],
      mood: MOODS.FAST,
      minutes: 15,
    });

    assert.equal(out.length, 1);
    assert.equal(out[0]?.meal.name, 'Egg Sauce');
  });

  it('still suggests something when the kitchen is empty', () => {
    const out = rankCandidates([quickEgg, riceDish], {
      ...baseInput,
      kitchenItems: [],
      mood: MOODS.FAST,
      minutes: 15,
    });

    assert.ok(out.length > 0);
  });
});
