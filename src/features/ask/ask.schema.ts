import { z } from 'zod';

import { ASK_STEPS } from './ask.types.js';

/**
 * What a client may send.
 *
 * Tight on purpose: these routes are PUBLIC and unauthenticated, so the schema
 * is the only thing between a stranger and the work behind them.
 */

export const StartAskSchema = z.object({});

export const UploadTicketSchema = z.object({
  content_type: z.string().min(1).max(80),
  /** Checked again in the service against the hard cap, and signed into the URL. */
  size: z.number().int().positive().max(1_000_000),
});

export const CreateTurnSchema = z
  .object({
    step: z.enum(ASK_STEPS),
    source: z.enum(['tap', 'text', 'voice']),
    /** Bounded: this is a sentence, not an essay, and it goes to a model. */
    text: z.string().min(1).max(1_000).optional(),
    audio_key: z.string().min(1).max(200).optional(),
  })
  .refine((value) => value.source !== 'text' || value.text !== undefined, {
    message: 'Typing needs text',
    path: ['text'],
  })
  .refine((value) => value.source !== 'voice' || value.audio_key !== undefined, {
    message: 'A voice note needs an uploaded recording',
    path: ['audio_key'],
  });

export type CreateTurnInput = z.infer<typeof CreateTurnSchema>;
export type UploadTicketInput = z.infer<typeof UploadTicketSchema>;

/**
 * A follow-up about a verdict already given.
 *
 * The shortlist comes from the CLIENT, which is safe because the service only
 * uses it to constrain the model — a caller who lies about it can make the
 * model swap to a meal they named, which is a meal they already had. It cannot
 * reach anything they were not shown.
 */
export const FollowUpSchema = z.object({
  /** One question, bounded: this goes to a model on a public route. */
  question: z.string().min(1).max(500),
  /** Meal ids the model may swap to. Everything else is rejected downstream. */
  allowed_meal_ids: z.array(z.string().min(1).max(60)).max(20),
  /** The verdict and kitchen, rendered by the client that holds them. */
  context: z.string().min(1).max(4_000),
});

export type FollowUpInput = z.infer<typeof FollowUpSchema>;
