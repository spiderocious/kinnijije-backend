import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AskFollowUpSchema, AskParseSchema } from '@lib/ai/ai.contracts.js';

import { CreateTurnSchema, FollowUpSchema, UploadTicketSchema } from '../ask.schema.js';

/**
 * The two boundaries that decide whether this feature is safe.
 *
 * The parse contract is what stands between a model and somebody's answers:
 * a reply that does not fit is REJECTED, never patched, so these tests pin the
 * shapes that are allowed through. The request schema is the only thing between
 * a stranger and a transcription bill, since every route here is public.
 */

/**
 * The envelope every structured reply carries.
 *
 * `notes` is deliberately omitted: it defaults, and a model with nothing to
 * warn about correctly returns no key at all.
 */
const metrics = {
  metrics: {
    outputLevel: 'complete' as const,
    outputConfidence: 0.9,
    clarity: 0.9,
    ambiguity: 0.1,
    tuneSuggestion: '',
  },
};

describe('AskParseSchema', () => {
  it('accepts a sentence that answered everything', () => {
    const result = AskParseSchema.safeParse({
      kitchenItems: ['Rice', 'Eggs'],
      mood: 'tired',
      weight: 'light',
      minutes: 15,
      constraints: ['no pepper'],
      unmatched: [],
      confidence: 0.86,
      ...metrics,
    });
    assert.equal(result.success, true);
  });

  it('accepts nulls for anything the sentence did not cover', () => {
    // The most important case. A model forced to produce a value invents one,
    // and an invented mood is worse than an unasked question.
    const result = AskParseSchema.safeParse({
      kitchenItems: ['Rice'],
      mood: null,
      weight: null,
      minutes: null,
      constraints: [],
      unmatched: [],
      confidence: 0.4,
      ...metrics,
    });
    assert.equal(result.success, true);
  });

  it('rejects a mood that is not one of ours', () => {
    const result = AskParseSchema.safeParse({
      kitchenItems: [],
      mood: 'hangry',
      weight: null,
      minutes: null,
      constraints: [],
      unmatched: [],
      confidence: 0.9,
      ...metrics,
    });
    assert.equal(result.success, false);
  });

  it('rejects a cook time we do not offer', () => {
    // 15, 40 or 90 are the only buckets the ranker understands. A 22 here
    // would pass into a filter that silently matches nothing.
    const result = AskParseSchema.safeParse({
      kitchenItems: [],
      mood: null,
      weight: null,
      minutes: 22,
      constraints: [],
      unmatched: [],
      confidence: 0.9,
      ...metrics,
    });
    assert.equal(result.success, false);
  });

  it('rejects a confidence outside 0 to 1', () => {
    const result = AskParseSchema.safeParse({
      kitchenItems: [],
      mood: null,
      weight: null,
      minutes: null,
      constraints: [],
      unmatched: [],
      confidence: 1.4,
      ...metrics,
    });
    assert.equal(result.success, false);
  });
});

describe('CreateTurnSchema', () => {
  it('accepts a tap with no payload', () => {
    const result = CreateTurnSchema.safeParse({ step: 'mood', source: 'tap' });
    assert.equal(result.success, true);
  });

  it('refuses typing with no text', () => {
    // Would otherwise queue a job that transcribes nothing and fails.
    const result = CreateTurnSchema.safeParse({ step: 'mood', source: 'text' });
    assert.equal(result.success, false);
  });

  it('refuses a voice note with no recording', () => {
    const result = CreateTurnSchema.safeParse({ step: 'mood', source: 'voice' });
    assert.equal(result.success, false);
  });

  it('refuses a step that is not one of the four questions', () => {
    const result = CreateTurnSchema.safeParse({ step: 'dessert', source: 'tap' });
    assert.equal(result.success, false);
  });

  it('caps the text length', () => {
    // Public route, straight to a model. Unbounded text is unbounded cost.
    const result = CreateTurnSchema.safeParse({
      step: 'mood',
      source: 'text',
      text: 'x'.repeat(1_001),
    });
    assert.equal(result.success, false);
  });
});

describe('UploadTicketSchema', () => {
  it('accepts a normal recording', () => {
    const result = UploadTicketSchema.safeParse({ content_type: 'audio/webm', size: 60_000 });
    assert.equal(result.success, true);
  });

  it('refuses anything over the megabyte cap', () => {
    // 30s of opus is about 60KB, so a megabyte is already generous. Past it,
    // somebody is not sending a voice note.
    const result = UploadTicketSchema.safeParse({ content_type: 'audio/webm', size: 2_000_000 });
    assert.equal(result.success, false);
  });

  it('refuses a zero-byte upload', () => {
    const result = UploadTicketSchema.safeParse({ content_type: 'audio/webm', size: 0 });
    assert.equal(result.success, false);
  });
});

describe('AskFollowUpSchema', () => {
  it('accepts a plain reply', () => {
    const result = AskFollowUpSchema.safeParse({
      action: 'reply',
      text: 'It freezes well, so cook the full pot.',
      mealId: null,
      refused: false,
      ...metrics,
    });
    assert.equal(result.success, true);
  });

  it('accepts a swap carrying a meal id', () => {
    const result = AskFollowUpSchema.safeParse({
      action: 'swap',
      text: 'Efo Riro is quicker. Switched.',
      mealId: 'meal_01abc',
      refused: false,
      ...metrics,
    });
    assert.equal(result.success, true);
  });

  it('refuses an action we do not implement', () => {
    // The model must not be able to invent a verb the app then ignores.
    const result = AskFollowUpSchema.safeParse({
      action: 'delete_account',
      text: 'Done.',
      mealId: null,
      refused: false,
      ...metrics,
    });
    assert.equal(result.success, false);
  });

  it('caps the reply length', () => {
    // This lands in a chat bubble. An essay is a broken layout.
    const result = AskFollowUpSchema.safeParse({
      action: 'reply',
      text: 'x'.repeat(400),
      mealId: null,
      refused: false,
      ...metrics,
    });
    assert.equal(result.success, false);
  });
});

describe('FollowUpSchema', () => {
  it('accepts an ordinary question', () => {
    const result = FollowUpSchema.safeParse({
      question: 'Can I use chicken instead?',
      allowed_meal_ids: ['meal_01abc'],
      context: 'KITCHEN: rice',
    });
    assert.equal(result.success, true);
  });

  it('refuses an unbounded question', () => {
    // Public route, straight to a model. Unbounded text is unbounded cost.
    const result = FollowUpSchema.safeParse({
      question: 'x'.repeat(600),
      allowed_meal_ids: [],
      context: 'KITCHEN: rice',
    });
    assert.equal(result.success, false);
  });

  it('refuses an oversized shortlist', () => {
    const result = FollowUpSchema.safeParse({
      question: 'Why?',
      allowed_meal_ids: Array.from({ length: 30 }, (_, i) => `meal_${String(i)}`),
      context: 'KITCHEN: rice',
    });
    assert.equal(result.success, false);
  });
});
