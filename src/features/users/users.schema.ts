import { z } from 'zod';

import { ALL_ROLES, ALL_STATUSES } from '@shared/constants/roles.js';
import { MAX_ADMIN_PAGE_SIZE } from '@lib/pagination.js';

export const UpdateSettingsSchema = z
  .object({
    name: z.string().min(1).max(120).trim().optional(),
    cuisines: z.array(z.string().max(40)).max(12).optional(),
    difficulty: z.enum(['easy', 'medium', 'anything']).optional(),
    measurement: z.enum(['metric', 'imperial']).optional(),
    city: z.string().max(80).trim().optional(),
    country: z.string().max(80).trim().optional(),
    running_low: z.boolean().optional(),
    use_it_up: z.boolean().optional(),
    have_you_eaten: z.boolean().optional(),
    daily_digest: z.boolean().optional(),
    weekly_summary: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one setting to change',
  });
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;

export const UpdateProfileSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(120, 'Name is too long').trim(),
  })
  // At least one field must be present, or the request is a no-op the client
  // probably did not intend.
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export const ListUsersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(MAX_ADMIN_PAGE_SIZE).optional(),
  role: z.enum(ALL_ROLES as [string, ...string[]]).optional(),
  status: z.enum(ALL_STATUSES as [string, ...string[]]).optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export const UserIdParamSchema = z.object({
  userId: z.string().min(1, 'User id is required'),
});
export type UserIdParam = z.infer<typeof UserIdParamSchema>;

export const UpdateStatusSchema = z.object({
  status: z.enum(ALL_STATUSES as [string, ...string[]]),
  reason: z.string().max(500, 'Reason is too long').trim().optional(),
});
export type UpdateStatusInput = z.infer<typeof UpdateStatusSchema>;

export const UpdateRoleSchema = z.object({
  role: z.enum(ALL_ROLES as [string, ...string[]]),
});
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;
