import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { indexStock, matchMeal } from '../meals.matcher.js';
import type { MealDocument } from '../meals.model.js';
import type { StockItemDocument } from '@features/stock/stock.model.js';

/**
 * "I have white garri" came back with a scrambled egg recipe.
 *
 * The catalogue carries four garri ids because a shopping list and an expiry
 * date care about the variety. Both garri recipes name `garri_ijebu`, so
 * somebody who tapped `garri_white` matched NOTHING — and a meal using only
 * their salt outranked the one thing they could actually make, in five
 * minutes, with no shopping.
 */
function ing(catalogueId: string | null, name: string, optional = false) {
  return { catalogueId, name, quantity: null, unit: null, optional };
}

function meal(ingredients: ReturnType<typeof ing>[]): MealDocument {
  return { name: 'Test', ingredients } as unknown as MealDocument;
}

/** Stock with real catalogue ids, which is what the decide flow produces. */
function stock(items: { id: string; name: string }[]): StockItemDocument[] {
  return items.map(
    (item) =>
      ({
        name: item.name,
        catalogueId: item.id,
        quantity: 1,
        unit: null,
      }) as unknown as StockItemDocument,
  );
}

describe('interchangeable ingredients', () => {
  it('accepts white garri where a recipe asks for Ijebu', () => {
    const soakings = meal([ing('garri_ijebu', 'Ijebu garri')]);
    const result = matchMeal(
      soakings,
      indexStock(stock([{ id: 'garri_white', name: 'White garri' }])),
    );

    assert.equal(result.score, 1);
    assert.equal(result.missing.length, 0);
  });

  it('lists what THEY have, not what the recipe called it', () => {
    // Showing "Ijebu garri" under "you have" reads as though we found
    // something they never said they had.
    const soakings = meal([ing('garri_ijebu', 'Ijebu garri')]);
    const result = matchMeal(
      soakings,
      indexStock(stock([{ id: 'garri_white', name: 'White garri' }])),
    );

    assert.equal(result.ingredients[0]?.name, 'White garri');
  });

  it('swaps within rice, beans and frying oils', () => {
    const dish = meal([
      ing('rice_long_grain', 'Long-grain rice'),
      ing('beans_brown', 'Brown beans'),
      ing('groundnut_oil', 'Groundnut oil'),
    ]);
    const result = matchMeal(
      dish,
      indexStock(
        stock([
          { id: 'rice_parboiled', name: 'Parboiled rice' },
          { id: 'beans_black_eyed', name: 'Black-eyed beans' },
          { id: 'olive_oil', name: 'Olive oil' },
        ]),
      ),
    );

    assert.equal(result.score, 1);
  });

  it('does NOT swap palm oil for a frying oil', () => {
    // Palm oil is a flavour, not a medium. Swapping it changes the dish, so
    // it is deliberately outside the oil group — the groups are things a cook
    // would swap without comment, not things that share a shelf.
    const dish = meal([ing('palm_oil', 'Palm oil')]);
    const result = matchMeal(
      dish,
      indexStock(stock([{ id: 'groundnut_oil', name: 'Groundnut oil' }])),
    );

    assert.equal(result.missing.length, 1);
  });

  it('does not invent a match across unrelated ingredients', () => {
    const dish = meal([ing('catfish', 'Catfish')]);
    const result = matchMeal(
      dish,
      indexStock(stock([{ id: 'garri_white', name: 'White garri' }])),
    );

    assert.equal(result.score, 0);
    assert.equal(result.missing.length, 1);
  });

  it('still prefers an exact match when the cook has both', () => {
    const dish = meal([ing('rice_long_grain', 'Long-grain rice')]);
    const result = matchMeal(
      dish,
      indexStock(
        stock([
          { id: 'rice_parboiled', name: 'Parboiled rice' },
          { id: 'rice_long_grain', name: 'Long-grain rice' },
        ]),
      ),
    );

    assert.equal(result.ingredients[0]?.name, 'Long-grain rice');
  });
});
