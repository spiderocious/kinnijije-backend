import { z } from 'zod';

import { ALL_MOODS, ALL_WEIGHTS, DECIDE_MODES, DEFAULT_TIME_BUDGET, TIME_BUDGETS } from './decide.types.js';

/**
 * Bounds mirror the existing contracts: 80 characters per item and 40 items,
 * exactly as `ExtractedItemSchema` already caps a photo read. A draft must not
 * become an upload channel, and `express.json({ limit: '1mb' })` is the outer
 * backstop behind this.
 */
export const DecideSchema = z.object({
  kitchen_items: z.array(z.string().min(1).max(80)).max(40).default([]),
  kitchen_skipped: z.boolean().default(false),

  // The only two required answers. Without either, nothing distinguishes this
  // person from a random pick — which is what the product exists to replace.
  mood: z.enum(ALL_MOODS as unknown as [string, ...string[]]),
  weight: z.enum(ALL_WEIGHTS as unknown as [string, ...string[]]),

  minutes: z
    .union([z.literal(TIME_BUDGETS[0]), z.literal(TIME_BUDGETS[1]), z.literal(TIME_BUDGETS[2])])
    .default(DEFAULT_TIME_BUDGET),

  city: z.string().max(80).trim().optional(),

  /** "I'll order" on the kitchen step. Absent is `cook`. */
  mode: z.enum(DECIDE_MODES).default('cook'),
  /** A saved place id. An unknown one is ignored rather than refused — it only steers ranking. */
  place_id: z.string().trim().min(1).max(60).optional(),

  /** Meals already refused this session. Capped like every other array here. */
  rejected: z.array(z.string().min(1).max(60)).max(20).default([]),
});

export type DecideInputRaw = z.infer<typeof DecideSchema>;
