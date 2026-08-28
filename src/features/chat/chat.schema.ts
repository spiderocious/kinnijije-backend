import { z } from 'zod';

export const AskSchema = z.object({
  question: z.string().min(1, 'Ask something').max(1000, 'That is too long to ask at once').trim(),
});
export type AskInput = z.infer<typeof AskSchema>;

