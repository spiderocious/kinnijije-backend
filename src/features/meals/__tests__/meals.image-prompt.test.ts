import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MealDocument } from '../meals.model.js';
import { composeImagePrompt, hintFor, IMAGE_PROMPT_VERSION } from '../meals.image-prompt.js';

function meal(over: Partial<MealDocument> & { name: string; slug: string }): MealDocument {
  return {
    ingredients: [],
    ...over,
  } as unknown as MealDocument;
}

function ingredient(name: string, optional = false) {
  return { catalogueId: null, name, quantity: null, unit: null, optional };
}

describe('hintFor', () => {
  it('matches a plain slug', () => {
    assert.ok(hintFor('jollof-rice')?.includes('NOT paella'));
  });

  it('matches a slug with the dish buried in it', () => {
    // "smoky-party-jollof" must still pick up the jollof correction.
    assert.ok(hintFor('smoky-party-jollof')?.includes('NOT yellow'));
  });

  it('returns null for a dish with no known confusion', () => {
    assert.equal(hintFor('boiled-yam'), null);
  });

  it('corrects the confusions that actually happen', () => {
    assert.ok(hintFor('egusi-soup')?.includes('guacamole'));
    assert.ok(hintFor('amala')?.includes('chocolate'));
    assert.ok(hintFor('akara')?.includes('doughnuts'));
  });
});

describe('composeImagePrompt', () => {
  const jollof = meal({
    name: 'Jollof Rice',
    slug: 'jollof-rice',
    ingredients: [ingredient('rice'), ingredient('tomato'), ingredient('parsley', true)],
  });

  it('names the dish', () => {
    assert.ok(composeImagePrompt(jollof).includes('Jollof Rice'));
  });

  it('lists the required ingredients only', () => {
    const prompt = composeImagePrompt(jollof);
    assert.ok(prompt.includes('rice'));
    // An optional garnish is not what the dish IS, and naming it invites the
    // model to make it the subject.
    assert.ok(!prompt.includes('parsley'));
  });

  it('carries the anti-restaurant clause', () => {
    // The clause that does the most work: without it every dish arrives
    // fine-dining-plated.
    const prompt = composeImagePrompt(jollof);
    assert.ok(prompt.includes('real Nigerian home'));
    assert.ok(prompt.includes('no restaurant plating'));
  });

  it('carries the negative clause', () => {
    const prompt = composeImagePrompt(jollof);
    assert.ok(prompt.includes('No text'));
    assert.ok(prompt.includes('No hands'));
  });

  it('appends the per-dish hint when there is one', () => {
    assert.ok(composeImagePrompt(jollof).includes('NOT paella'));
  });

  it('omits the hint line entirely when there is none', () => {
    const prompt = composeImagePrompt(meal({ name: 'Boiled Yam', slug: 'boiled-yam' }));
    assert.ok(!prompt.includes('NOT paella'));
    assert.ok(prompt.includes('Boiled Yam'));
  });

  it('handles a recipe with no ingredients', () => {
    const prompt = composeImagePrompt(meal({ name: 'Mystery', slug: 'mystery' }));
    assert.ok(!prompt.includes('Made with'));
  });

  it('has a version to sweep on', () => {
    assert.ok(Number.isInteger(IMAGE_PROMPT_VERSION));
  });
});
