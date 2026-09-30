import { z } from 'zod';

/** Only what a browser can render and we can derive from. */
export const RequestImageUploadSchema = z.object({
  content_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  content_length: z.number().int().positive().max(10 * 1024 * 1024),
});

export const ConfirmImageUploadSchema = z.object({
  content_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
});

export const GenerateImageSchema = z.object({
  /**
   * An operator's edited prompt.
   *
   * The fast path when a dish comes back as the wrong food: add the missing
   * clause, regenerate, see the result in a minute.
   */
  prompt_override: z.string().min(20).max(4000).optional(),
});

export const RejectImageSchema = z.object({
  /**
   * Required, and the reason it is required: a rejection with no reason
   * teaches nobody anything, and these become the per-dish hint map.
   */
  reason: z.string().min(1).max(200),
});

export const SetPrimaryImageSchema = z.object({
  image_id: z.string().min(1).max(60),
});
