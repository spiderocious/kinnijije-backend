import { z } from 'zod';

import { ALL_DIFFICULTIES, CUISINE_OPTIONS } from '@shared/constants/roles.js';

/**
 * Every field is optional: onboarding is saved step by step, and each step
 * sends only what it collected. A partial save must not wipe a prior answer.
 */
export const SaveOnboardingSchema = z
  .object({
    cuisines: z
      .array(z.enum(CUISINE_OPTIONS as [string, ...string[]]))
      .max(CUISINE_OPTIONS.length)
      .optional(),
    difficulty: z.enum(ALL_DIFFICULTIES as [string, ...string[]]).optional(),
    measurement: z.enum(['metric', 'imperial']).optional(),
    kitchen_items: z
      .array(z.string().min(1).max(80).trim())
      .max(100, 'That is more than we can take at once')
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to save',
  });

export type SaveOnboardingInput = z.infer<typeof SaveOnboardingSchema>;
