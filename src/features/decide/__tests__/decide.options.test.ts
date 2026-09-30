import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { decideOptions, TILE_CAPTIONS } from '../decide.options.js';
import { ALL_MOODS, ALL_WEIGHTS, TIME_BUDGETS } from '../decide.types.js';

/**
 * Every icon name the options endpoint emits must EXIST in the koboyo set.
 *
 * A name that does not exist renders nothing at all — a blank tile, with no
 * error anywhere. That is exactly the kind of bug that reaches production, so
 * it is asserted against the real glyph file rather than trusted.
 */
const GLYPH_FILE = new URL(
  '../../../../../web/src/ui/icons/koboyo-data.ts',
  import.meta.url,
);

function availableGlyphs(): Set<string> {
  const source = readFileSync(GLYPH_FILE, 'utf8');
  return new Set([...source.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1] as string));
}

describe('decideOptions', () => {
  const view = decideOptions();

  it('offers kitchen groups', () => {
    assert.ok(view.kitchen.length > 0);
    assert.ok(view.kitchen.every((group) => group.items.length > 0));
  });

  it('offers every mood', () => {
    assert.deepEqual(
      view.moods.map((m) => m.id).sort(),
      [...ALL_MOODS].sort(),
    );
  });

  it('offers every weight', () => {
    assert.deepEqual(
      view.weights.map((w) => w.id).sort(),
      [...ALL_WEIGHTS].sort(),
    );
  });

  it('offers every time budget, labelled', () => {
    assert.deepEqual(view.minutes.map((m) => m.value), [...TIME_BUDGETS]);
    assert.ok(view.minutes.every((m) => m.label.length > 0));
  });

  it('captions every mood and weight', () => {
    // The caption states the CONSEQUENCE, so a tile without one leaves the
    // person guessing what their answer changes.
    for (const mood of ALL_MOODS) assert.ok(TILE_CAPTIONS.moods[mood]);
    for (const weight of ALL_WEIGHTS) assert.ok(TILE_CAPTIONS.weights[weight]);
  });

  it('uses only icon names that exist in the koboyo set', () => {
    const glyphs = availableGlyphs();
    assert.ok(glyphs.size > 100, 'expected to read the real glyph file');

    const used = new Set<string>();
    for (const group of view.kitchen) for (const item of group.items) used.add(item.icon);
    for (const mood of view.moods) used.add(mood.icon);
    for (const weight of view.weights) used.add(weight.icon);

    const missing = [...used].filter((name) => !glyphs.has(name));
    assert.deepEqual(missing, [], `these icons do not exist: ${missing.join(', ')}`);
  });

  it('gives every kitchen tile a catalogue id', () => {
    for (const group of view.kitchen) {
      for (const item of group.items) {
        assert.ok(item.catalogue_id !== undefined, `${item.label} has no catalogue id`);
      }
    }
  });
});
