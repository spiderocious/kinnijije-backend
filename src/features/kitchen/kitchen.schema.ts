import { z } from 'zod';

/**
 * The screen owns the whole basket, so a save REPLACES it rather than
 * appending. A PATCH-style merge would make removing the last item
 * indistinguishable from sending nothing.
 */
export const SaveKitchenSchema = z.object({
  items: z
    .array(z.string().min(1, 'An ingredient cannot be blank').max(80, 'That name is too long').trim())
    .max(100, 'That is more than we can take at once'),
});

export type SaveKitchenInput = z.infer<typeof SaveKitchenSchema>;
