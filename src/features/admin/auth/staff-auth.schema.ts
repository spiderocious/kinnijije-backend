import { z } from 'zod';

export const StaffLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export const StaffRefreshSchema = z.object({
  refresh_token: z.string().min(20).max(400),
});

export const StaffLogoutSchema = StaffRefreshSchema;
