import { z } from 'zod';

import { EMAIL_KINDS } from '@lib/mail/email-log.model.js';

const KINDS = Object.values(EMAIL_KINDS) as [string, ...string[]];

/**
 * The composer.
 *
 * Capped at 25 users on purpose: previewing `daily_digest` runs a live model
 * call per person, so an uncapped selection is an accidental bill.
 */
export const ComposeSchema = z.object({
  kind: z.enum(KINDS),
  user_ids: z.array(z.string().min(1).max(64)).min(1).max(25),
});

export const EditDraftSchema = z
  .object({
    subject: z.string().trim().min(1).max(300).optional(),
    text: z.string().min(1).max(50_000).optional(),
    html: z.string().min(1).max(200_000).optional(),
  })
  .refine(
    (body) => body.subject !== undefined || body.text !== undefined || body.html !== undefined,
    { message: 'Nothing to change' },
  );

export const ExcludeDraftSchema = z.object({
  reason: z.string().trim().min(1).max(300).optional(),
});

export const ListBatchesSchema = z.object({
  kind: z.enum(KINDS).optional(),
  status: z.enum(['drafting', 'pending_review', 'approved', 'sending', 'sent', 'discarded']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

/** Operator settings for one kind. Every field optional — this is a patch. */
export const UpdateEmailSettingSchema = z.object({
  enabled: z.boolean().optional(),
  autoApprove: z.boolean().optional(),
  schedule: z
    .object({
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
      dayOfWeek: z.number().int().min(0).max(6).nullable(),
      // Validated as a real zone, because a typo here silently moves every
      // send to UTC.
      timezone: z.string().min(1).max(64),
    })
    .optional(),
  rules: z
    .object({
      minStockItems: z.number().int().min(0).max(1000),
      minCookableMeals: z.number().int().min(0).max(100),
      maxStockItems: z.number().int().min(0).max(1000).nullable(),
      activeWithinDays: z.number().int().min(1).max(365).nullable(),
      requireOnboarded: z.boolean(),
      minAccountAgeHours: z.number().int().min(0).max(8760),
    })
    .optional(),
  minHoursBetween: z.number().int().min(1).max(8760).nullable().optional(),
  reason: z.string().trim().min(1).max(300).optional(),
});
