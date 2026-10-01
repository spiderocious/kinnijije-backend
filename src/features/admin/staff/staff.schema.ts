import { z } from 'zod';

import { ALL_SCOPES } from '@shared/constants/permissions.js';
import { SEEDED_GROUPS } from '@shared/constants/permission-groups.js';

const GROUP_KEYS = SEEDED_GROUPS.map((group) => group.key) as [string, ...string[]];
const SCOPE_VALUES = [...ALL_SCOPES] as [string, ...string[]];

/**
 * Both lists are closed enums, not free strings.
 *
 * A misspelt scope that validates is a permission silently not granted — and
 * nobody notices until somebody cannot do their job. `z.enum` over the
 * generated list means a typo is a 422 with the field named.
 */
export const RevokeStaffSchema = z.object({
  /** Why. Shown in the staff list and recorded in the trail. */
  reason: z.string().trim().min(1).max(500).optional(),
});

export const InviteStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(120),
  // `super_admin` is absent on purpose: there is exactly one owner tier and it
  // is not handed out through a form.
  tier: z.enum(['moderator', 'admin']),
  group_keys: z.array(z.enum(GROUP_KEYS)).max(4).default([]),
  scopes: z.array(z.enum(SCOPE_VALUES)).max(40).default([]),
});

export const SetPermissionsSchema = z.object({
  group_keys: z.array(z.enum(GROUP_KEYS)).max(4).default([]),
  scopes: z.array(z.enum(SCOPE_VALUES)).max(40).default([]),
});

/**
 * Twelve characters minimum for a console password.
 *
 * Higher than the customer minimum deliberately: this account can read every
 * customer's record and email the whole list.
 */
export const AcceptInviteSchema = z.object({
  password: z.string().min(12).max(200),
});

export const ListAuditSchema = z.object({
  actor_id: z.string().max(64).optional(),
  resource: z.string().max(40).optional(),
  action: z.string().max(80).optional(),
  outcome: z.enum(['success', 'denied', 'error']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});
