import { z } from 'zod';

/**
 * Generating a recipe from a name the assistant produced.
 *
 * The name is the whole input — everything else is written by the model and
 * validated on the way back.
 */
export const GenerateMealSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(1, 'Which meal?')
      .max(120, 'That name is too long to be a meal')
      .trim(),
  }),
});
