import { z } from 'zod';

import { ALL_UNIT_IDS } from '@shared/catalogue/index.js';
import { STOCK_SOURCES } from './stock.model.js';

/**
 * A unit must be one we know OR one this person invented. Custom units are
 * validated against the database in the service — a closed enum here would
 * make "add your own unit" impossible.
 */
const unitId = z.string().min(1).max(40);

export const StockEntrySchema = z.object({
  /** Set when the cook picked a suggestion; absent for free text. */
  catalogue_id: z.string().max(60).optional(),
  name: z.string().min(1, 'An ingredient needs a name').max(80).trim(),
  quantity: z.number().positive('Quantity must be more than zero').max(100_000),
  unit: unitId,
  storage: z.enum(['fridge', 'shelf', 'freezer']).optional(),
});

export const AddStockSchema = z.object({
  items: z.array(StockEntrySchema).min(1, 'Add at least one thing').max(100),
  source: z.enum(Object.values(STOCK_SOURCES) as [string, ...string[]]).optional(),
  reference: z.string().max(200).optional(),
});
export type AddStockInput = z.infer<typeof AddStockSchema>;

export const UpdateStockSchema = z.object({
  quantity: z.number().min(0, 'Quantity cannot be negative').max(100_000).optional(),
  unit: unitId.optional(),
  storage: z.enum(['fridge', 'shelf', 'freezer']).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field' });
export type UpdateStockInput = z.infer<typeof UpdateStockSchema>;

export const CreateCustomUnitSchema = z.object({
  label: z
    .string()
    .min(1, 'A unit needs a name')
    .max(40, 'That name is too long')
    .trim()
    // Attached to `label`, NOT to the object. A refine on the object has no
    // path, so its message lands under `_root` — where no input can show it and
    // the person only ever sees the generic "some details are not valid".
    .refine((value) => !ALL_UNIT_IDS.includes(value.toLowerCase()), {
      message: 'We already have that unit — you can pick it from the list.',
    }),
  abbr: z.string().min(1, 'Give it a short form').max(12, 'Keep the short form under 12 characters').trim(),
});
export type CreateCustomUnitInput = z.infer<typeof CreateCustomUnitSchema>;

export const StockIdParamSchema = z.object({ stockId: z.string().min(1) });
export const SuggestQuerySchema = z.object({
  q: z.string().min(1).max(60),
  limit: z.coerce.number().int().positive().max(20).optional(),
});
