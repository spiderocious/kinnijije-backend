import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Schema, model } from 'mongoose';
import type { Response } from 'express';

import { ResponseUtil } from '../response.js';

/**
 * What actually reaches the wire.
 *
 * Exercised through `ResponseUtil` rather than the private `serialise`, because
 * the contract worth protecting is "this body can be written as a response",
 * not the shape of one internal function.
 */

/** Captures what a handler would have sent, without an HTTP server. */
function fakeResponse(): Response & { sent: unknown; code: number } {
  const res = {
    code: 0,
    sent: undefined as unknown,
    status(value: number) {
      res.code = value;
      return res;
    },
    json(body: unknown) {
      res.sent = body;
      return res;
    },
    end() {
      return res;
    },
  };
  return res as unknown as Response & { sent: unknown; code: number };
}

const stepSchema = new Schema({ n: Number, text: String }, { _id: false });
const RecipeModel = model(
  'SerialiseTestRecipe',
  new Schema({
    _id: { type: String, default: 'meal_test' },
    name: String,
    steps: { type: [stepSchema], default: [] },
    keys: { type: [String], default: [] },
  }),
);

describe('response serialisation', () => {
  /**
   * THE REGRESSION. `GET /admin/recipes/:mealId` returned `meal.steps`
   * straight off the document — a Mongoose DocumentArray. Every subdocument in
   * one enumerates `__parentArray` and `$__parent`, which point back at the
   * array and the document holding it, so walking it with `Object.entries`
   * descended forever and the endpoint 500'd with
   * `RangeError: Maximum call stack size exceeded`.
   *
   * A `[String]` path never showed this (its members are primitives), which is
   * exactly why it went unnoticed: the difference is invisible at the callsite.
   */
  it('does not blow the stack on a raw subdocument array', () => {
    const doc = new RecipeModel({
      name: 'Jollof',
      steps: [
        { n: 1, text: 'Blend the peppers' },
        { n: 2, text: 'Fry the base' },
      ],
      keys: ['rice', 'tomato'],
    });

    const res = fakeResponse();
    // Would have thrown RangeError before the fix.
    ResponseUtil.ok(res, { steps: doc.steps, keys: doc.keys });

    assert.deepEqual(res.sent, {
      data: {
        steps: [
          { n: 1, text: 'Blend the peppers' },
          { n: 2, text: 'Fry the base' },
        ],
        keys: ['rice', 'tomato'],
      },
    });
  });

  it('serialises a whole document without leaking mongoose internals', () => {
    const doc = new RecipeModel({ name: 'Egusi', steps: [{ n: 1, text: 'Grind' }] });

    const res = fakeResponse();
    ResponseUtil.ok(res, doc);

    const body = JSON.stringify(res.sent);
    // The three keys that carried the cycle must not appear at all.
    assert.ok(!body.includes('__parentArray'), 'leaked __parentArray');
    assert.ok(!body.includes('$__parent'), 'leaked $__parent');
    assert.ok(!body.includes('"_doc"'), 'leaked _doc');
    assert.ok(body.includes('Egusi'));
  });

  it('still converts dates to ISO strings', () => {
    const res = fakeResponse();
    ResponseUtil.ok(res, { when: new Date('2026-01-01T00:00:00.000Z') });
    assert.deepEqual(res.sent, { data: { when: '2026-01-01T00:00:00.000Z' } });
  });

  it('still converts bigint, as a number while it fits and a string past that', () => {
    const res = fakeResponse();
    ResponseUtil.ok(res, { small: 42n, huge: 2n ** 70n });
    assert.deepEqual(res.sent, { data: { small: 42, huge: '1180591620717411303424' } });
  });

  it('still strips undefined-valued keys', () => {
    const res = fakeResponse();
    ResponseUtil.ok(res, { kept: 1, dropped: undefined });
    assert.deepEqual(res.sent, { data: { kept: 1 } });
  });

  it('leaves plain nested structures alone', () => {
    const res = fakeResponse();
    ResponseUtil.ok(res, { a: [{ b: [1, 2] }], c: null });
    assert.deepEqual(res.sent, { data: { a: [{ b: [1, 2] }], c: null } });
  });
});
