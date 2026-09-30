import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { indexStock, matchMeal, INGREDIENT_STATES } from '../meals.matcher.js';
import type { MealDocument } from '../meals.model.js';
import type { StockItemDocument } from '@features/stock/stock.model.js';

function ing(catalogueId: string | null, name: string, optional = false) {
  return { catalogueId, name, quantity: null, unit: null, optional };
}

function meal(ingredients: ReturnType<typeof ing>[]): MealDocument {
  return { name: 'Test', ingredients } as unknown as MealDocument;
}

function stock(names: string[]): StockItemDocument[] {
  return names.map(
    (name) => ({ name, catalogueId: null, quantity: 1, unit: null }) as unknown as StockItemDocument,
  );
}

describe('pantry staples', () => {
  it('does not count salt against the score', () => {
    // THE REGRESSION. Salt is a required ingredient in 83 of 100 seeded
    // recipes. Counting it penalised every meal equally and pushed every score
    // toward zero, which left the ranking nothing to discriminate on.
    const m = meal([ing('yam', 'Yam'), ing('salt', 'Salt')]);
    const result = matchMeal(m, indexStock(stock(['Yam'])));

    assert.equal(result.score, 1, 'having the one real ingredient should be a full match');
    assert.deepEqual(result.missing, [], 'salt is not a shopping item');
    assert.deepEqual(result.pantry, ['Salt']);
  });

  it('still SHOWS the staple, so a cook knows the recipe wants it', () => {
    // Exempt from the score is not the same as hidden: somebody with no salt
    // still needs to know.
    const m = meal([ing('yam', 'Yam'), ing('salt', 'Salt')]);
    const result = matchMeal(m, indexStock(stock(['Yam'])));
    const saltRow = result.ingredients.find((i) => i.name === 'Salt');
    assert.equal(saltRow?.state, INGREDIENT_STATES.PANTRY);
  });

  it('matches a staple normally when the cook DID tap it', () => {
    const m = meal([ing('yam', 'Yam'), ing('salt', 'Salt')]);
    const result = matchMeal(m, indexStock(stock(['Yam', 'Salt'])));
    assert.deepEqual(result.pantry, [], 'a tapped staple is ordinary stock');
    assert.equal(result.score, 1);
  });

  it('leaves real purchases alone', () => {
    // Palm oil and crayfish are common but are genuinely bought, so they must
    // still count. The bar for pantry is "almost every kitchen, almost always".
    const m = meal([ing('yam', 'Yam'), ing('palm_oil', 'Palm oil'), ing('crayfish', 'Crayfish')]);
    const result = matchMeal(m, indexStock(stock(['Yam'])));
    assert.deepEqual(result.pantry, []);
    assert.deepEqual(result.missing.sort(), ['Crayfish', 'Palm oil']);
  });

  it('raises a realistic score out of the floor', () => {
    // The reported case: yam and eggs against Boiled Yam and Egg Sauce scored
    // 0.13 of 8 ingredients. Excluding the three staples makes it 0.40 of 5,
    // which is what a person would call "I am most of the way there".
    const m = meal([
      ing('yam', 'Yam'), ing('egg_chicken', 'Eggs'), ing('tomato', 'Tomatoes'),
      ing('onion_red', 'Red onions'), ing('scotch_bonnet', 'Scotch bonnet'),
      ing('groundnut_oil', 'Groundnut oil'), ing('stock_cube', 'Stock cubes'), ing('salt', 'Salt'),
    ]);
    const result = matchMeal(m, indexStock(stock(['Yam', 'Eggs'])));
    assert.ok(result.score >= 0.4, `score was ${String(result.score)}, expected >= 0.4`);
    assert.equal(result.missing.length, 3);
    assert.equal(result.pantry.length, 3);
  });

  it('treats a meal of only staples as fully makeable', () => {
    // No required non-pantry ingredients means nothing stands in the way.
    const result = matchMeal(meal([ing('salt', 'Salt'), ing('water', 'Water')]), indexStock([]));
    assert.equal(result.score, 1);
  });
});
