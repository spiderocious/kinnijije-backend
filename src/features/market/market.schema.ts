import { z } from 'zod';

export const AddMarketItemSchema = z.object({
  catalogue_id: z.string().max(60).optional(),
  name: z.string().min(1, 'Give it a name').max(80).trim(),
  quantity: z.number().positive().max(10_000).optional(),
  unit: z.string().min(1).max(40).optional(),
  reason: z.string().max(200).optional(),
});
export type AddMarketItemInput = z.infer<typeof AddMarketItemSchema>;

export const ToggleBoughtSchema = z.object({
  bought: z.boolean(),
});
export type ToggleBoughtInput = z.infer<typeof ToggleBoughtSchema>;

export const MarketIdParamSchema = z.object({ marketId: z.string().min(1) });
