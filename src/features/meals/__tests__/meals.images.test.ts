import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRecipeImageKey, DERIVATIVE_FILES } from '../meals.images.js';

describe('buildRecipeImageKey', () => {
  it('lands under the public prefix', () => {
    // The prefix IS the security boundary: putPublicObject refuses anything
    // outside it, so a key that misses it cannot be written at all.
    assert.ok(buildRecipeImageKey('jollof-rice').startsWith('public/'));
  });

  it('includes the slug, so a key is legible in a bucket listing', () => {
    assert.ok(buildRecipeImageKey('jollof-rice').includes('jollof-rice'));
  });

  it('is unique per call', () => {
    // The nonce is what lets the cache header be immutable for a year: a
    // regenerated image is a NEW url, so nothing ever needs purging.
    const a = buildRecipeImageKey('jollof-rice');
    const b = buildRecipeImageKey('jollof-rice');
    assert.notEqual(a, b);
  });

  it('names three derivatives', () => {
    assert.deepEqual([...DERIVATIVE_FILES], ['hero.webp', 'card.webp', 'thumb.webp']);
  });
});
