import { z } from 'zod';

/**
 * Password policy in one place, used by register and by change-password. A
 * second copy is a second thing to forget when the policy changes.
 */
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password must be at most 200 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a digit');

const email = z
  .string()
  .min(1, 'Email is required')
  .email('Enter a valid email address')
  // Normalised here, at the boundary, so every layer below sees one canonical
  // form and the unique index behaves.
  .transform((value) => value.trim().toLowerCase());

export const RegisterSchema = z.object({
  email,
  password,
  name: z.string().min(1, 'Name is required').max(120, 'Name is too long').trim(),
  /**
   * Optional, and asked for at signup because it is what makes the weather in
   * the daily email real. Asking later means most people never answer.
   */
  city: z.string().max(80, 'That is a long city name').trim().optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email,
  // Deliberately not the strong `password` schema: an old password that no
  // longer meets a tightened policy must still be able to sign in, and
  // reporting policy violations on login tells an attacker about the policy.
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});
export type RefreshInput = z.infer<typeof RefreshSchema>;

export const LogoutSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});
export type LogoutInput = z.infer<typeof LogoutSchema>;

export const ChangePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: password,
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/**
 * Asking for a reset link.
 *
 * Only the address, and the response never says whether it exists — see the
 * service for why.
 */
export const RequestPasswordResetSchema = z.object({
  body: z.object({
    email: z.string().email('That does not look like an email address').toLowerCase().trim(),
  }),
});

/** Spending a reset link. The token comes from the emailed URL. */
export const ResetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(20, 'That link looks incomplete'),
    new_password: password,
  }),
});
