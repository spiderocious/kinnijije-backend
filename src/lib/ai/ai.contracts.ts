import { z } from 'zod';

/**
 * The shapes every model answer must fit.
 *
 * These are enforced, not hoped for: a reply that does not parse is REJECTED,
 * never patched up. Half-understood model output is worse than none — it looks
 * like data and behaves like a bug.
 */

/**
 * Metrics we force the model to grade its own answer with.
 *
 * These NEVER reach the interface. They go to the prompt log, so a prompt can
 * be judged on more than whether it happened to parse — a run of low-confidence
 * or high-ambiguity answers is the signal that a prompt needs work, and
 * `tuneSuggestion` is the model's own account of what confused it.
 */
export const OutputMetricsSchema = z.object({
  /** How complete the answer is: partial answers must say so. */
  outputLevel: z.enum(['complete', 'partial', 'minimal', 'refused']),
  /** 0–1. How sure the model is of its own answer. */
  outputConfidence: z.number().min(0).max(1),
  /** 0–1. How clear the INPUT was. Low means the photo or text was poor. */
  clarity: z.number().min(0).max(1),
  /** 0–1. How much guessing was required. High means treat with suspicion. */
  ambiguity: z.number().min(0).max(1),
  /** What the model would change about the instructions it was given. */
  tuneSuggestion: z.string().max(500),
});

export type OutputMetrics = z.infer<typeof OutputMetricsSchema>;

/**
 * What a person is allowed to see.
 *
 * Every field is optional and must be OMITTED when there is nothing to say.
 * A model that always emits "no issues found" trains people to ignore the
 * field entirely, which is how a real warning gets missed.
 */
export const UserFacingNotesSchema = z.object({
  summary: z.string().max(300).optional(),
  /** Guesses the model made that a person should check. */
  assumptions: z.array(z.string().max(200)).max(10).optional(),
  /** Recoverable problems — a blurry photo, a partly unreadable line. */
  warnings: z.array(z.string().max(200)).max(10).optional(),
  /** Why nothing usable came back. */
  errors: z.array(z.string().max(200)).max(10).optional(),
});

export type UserFacingNotes = z.infer<typeof UserFacingNotesSchema>;

/**
 * Every structured answer carries its notes and its metrics.
 *
 * `notes` DEFAULTS rather than being required. Every field inside it is
 * optional and the prompt tells the model to omit what it has nothing to say
 * about — so a model with no warnings correctly returns no `notes` key at all.
 * Requiring the wrapper meant a perfect read of a photo ("items": [yam]) was
 * thrown away for having nothing to complain about, and the person was told
 * their clear photo could not be read. Absent notes means "nothing to report",
 * which is the good case, not a malformed answer.
 */
const withEnvelope = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    ...shape,
    notes: UserFacingNotesSchema.default({}),
    metrics: OutputMetricsSchema,
  });

// ── Is this even a photo of food? ──

export const PhotoVerdictSchema = withEnvelope({
  /**
   * `kitchen_scene` — a shelf, fridge, counter, or the food on it
   * `receipt`       — a printed till receipt
   * `food_but_not_useful` — food, but nothing identifiable (a cooked plate)
   * `not_food`      — a person, a pet, a screenshot, anything else
   * `unreadable`    — too dark, too blurred, too far
   */
  verdict: z.enum(['kitchen_scene', 'receipt', 'food_but_not_useful', 'not_food', 'unreadable']),
  /** True only for kitchen_scene and receipt — the two we can extract from. */
  usable: z.boolean(),
  /** One line a person can act on: "too dark to read", "this looks like a screenshot". */
  reason: z.string().max(200),
});

export type PhotoVerdict = z.infer<typeof PhotoVerdictSchema>;

// ── Reading ingredients out of a photo or a receipt ──

export const ExtractedItemSchema = z.object({
  /** As the model saw it. Matched against the catalogue on our side, not theirs. */
  name: z.string().min(1).max(80),
  /** Null when genuinely not visible — a guessed number is worse than none. */
  quantity: z.number().positive().nullable(),
  /** A unit id from the list we supply, or null. Never invented. */
  unit: z.string().max(30).nullable(),
  /** 0–1, per item. One blurry label should not devalue the whole read. */
  confidence: z.number().min(0).max(1),
  /** Which photo it came from, so a bad read can be traced to its source. */
  sourceIndex: z.number().int().min(0).optional(),
});

export const ExtractionResultSchema = withEnvelope({
  items: z.array(ExtractedItemSchema).max(100),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ── Generating a recipe ──

export const GeneratedRecipeSchema = withEnvelope({
  name: z.string().min(1).max(120),
  cuisines: z.array(z.string().max(40)).max(5),
  difficulty: z.enum(['easy', 'medium', 'involved']),
  cookTimeMinutes: z.number().int().positive().max(600),
  serves: z.number().int().positive().max(50),
  /** Why anyone cooks this — the thing a recipe database never tells you. */
  whatMakesItGood: z.string().max(400),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        quantity: z.string().max(60),
        /** Always true for generated recipes; the PRD requires estimates be labelled. */
        approximate: z.literal(true),
      }),
    )
    .min(1)
    .max(40),
  steps: z
    .array(
      z.object({
        index: z.number().int().positive(),
        heading: z.string().min(1).max(80),
        description: z.string().min(1).max(600),
        estMinutes: z.number().int().min(0).max(240),
      }),
    )
    .min(1)
    .max(30),
});

// ── Chat ──

/**
 * The model declares what KIND of answer it is giving, and the interface
 * renders accordingly. Without this every reply is a wall of text and a meal
 * can never be tapped.
 */
export const ChatReplySchema = withEnvelope({
  kind: z.enum(['text', 'meal_list', 'single_meal', 'stock_answer', 'substitution', 'refusal']),
  /** Always present — the words shown above whatever else is rendered. */
  text: z.string().max(2000),
  /** For meal_list and single_meal. */
  meals: z
    .array(
      z.object({
        /** Set when it is a meal we actually have; null when the model invented it. */
        mealId: z.string().nullable(),
        name: z.string().min(1).max(120),
        why: z.string().max(300),
        cookTimeMinutes: z.number().int().positive().max(600).nullable(),
        difficulty: z.enum(['easy', 'medium', 'involved']).nullable(),
        /** What the cook already has, by name. */
        have: z.array(z.string().max(80)).max(40),
        missing: z.array(z.string().max(80)).max(40),
      }),
    )
    .max(6)
    .optional(),
  /**
   * Where the answer came from.
   *   kitchen — their own stock · recipe — a tested recipe · general — weakest
   */
  source: z.enum(['kitchen', 'recipe', 'general']),
  citations: z.array(z.string().max(200)).max(10),
  /**
   * Tool calls the model wants run. Executed by the server, whose RESULTS are
   * then handed back to the model for a second turn — the person sees that
   * answer, not this one.
   */
  toolCalls: z.array(z.unknown()).max(6).optional(),
});

export type ChatReply = z.infer<typeof ChatReplySchema>;

// ── The weekly reading ──

export const WeekInsightSchema = withEnvelope({
  headline: z.string().max(160),
  observations: z
    .array(
      z.object({
        kind: z.enum(['repeat', 'variety', 'spend', 'nutrition', 'waste', 'streak']),
        statement: z.string().max(240),
        /** What it was drawn from. An observation with no evidence is a guess. */
        evidence: z.array(z.string().max(160)).min(1).max(8),
        tone: z.enum(['neutral', 'positive', 'watch']),
      }),
    )
    .max(8),
  suggestion: z.string().max(240).nullable(),
});

export type WeekInsight = z.infer<typeof WeekInsightSchema>;
