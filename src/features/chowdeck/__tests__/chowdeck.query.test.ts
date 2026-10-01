import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chowdeckQuery, offerKey } from '../chowdeck.model.js';

/**
 * The name we send a vendor, versus the name we show a cook.
 *
 * "Nigerian" is our classification, not theirs: nobody lists "Nigerian Jollof
 * Rice" on a menu, they list "Jollof Rice", so carrying the word narrows a
 * search that should have been wide.
 *
 * This runs on three call sites — the user path, the warming job and the
 * admin coverage grid — and they all derive the cache key from it, so a change
 * here silently orphans cached rows. That is why it is pinned this closely.
 */
describe('chowdeckQuery', () => {
  it('strips a leading Nigerian', () => {
    assert.equal(chowdeckQuery('Nigerian Beef Stew'), 'Beef Stew');
  });

  it('ignores case', () => {
    assert.equal(chowdeckQuery('NIGERIAN Jollof'), 'Jollof');
    assert.equal(chowdeckQuery('nigerian salad'), 'salad');
  });

  it('leaves a name that never mentioned it alone', () => {
    assert.equal(chowdeckQuery('Jollof Rice'), 'Jollof Rice');
    assert.equal(chowdeckQuery('Egusi Soup'), 'Egusi Soup');
  });

  it('takes the suffix with it', () => {
    // Stripping the bare word alone would leave "style Omelette", which is
    // worse as a search term than the original.
    assert.equal(chowdeckQuery('Nigerian-style Omelette'), 'Omelette');
    assert.equal(chowdeckQuery('Nigerian style Jollof'), 'Jollof');
  });

  it('clears up the punctuation it orphans', () => {
    assert.equal(chowdeckQuery('Suya (Nigerian)'), 'Suya');
    assert.equal(chowdeckQuery('Nigerian - Suya'), 'Suya');
  });

  it('collapses the whitespace it leaves behind', () => {
    assert.equal(chowdeckQuery('  Nigerian   Fried   Rice  '), 'Fried Rice');
  });

  it('never returns an empty query', () => {
    // A blank search asks a vendor for everything rather than nothing, which
    // is the one outcome worse than an over-narrow term. The original name is
    // the honest fallback.
    assert.equal(chowdeckQuery('Nigerian'), 'Nigerian');
    assert.equal(chowdeckQuery('nigerian'), 'nigerian');
  });

  it('does not touch a word that merely contains it', () => {
    // Whole-word only. A substring replace would corrupt anything that
    // happened to embed the letters.
    assert.equal(chowdeckQuery('Nigerianisms Stew'), 'Nigerianisms Stew');
  });

  it('produces one cache key for one meal across every call site', () => {
    // The user path, the job and the coverage grid must agree, or warming
    // writes a row that reading never finds.
    assert.equal(
      offerKey('place_1', chowdeckQuery('Nigerian Fried Rice')),
      offerKey('place_1', chowdeckQuery('Fried Rice')),
    );
  });
});
