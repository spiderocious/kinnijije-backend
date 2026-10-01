import { z } from 'zod';

const pagination = {
  limit: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
};

export const ListRecipesSchema = z.object({
  search: z.string().max(120).optional(),
  status: z.enum(['draft', 'published']).optional(),
  source: z.enum(['seed', 'ai']).optional(),
  ...pagination,
});

const ingredientInput = z.object({
  name: z.string().min(1).max(80),
  quantity: z.number().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  optional: z.boolean().optional(),
});

const stepInput = z.object({
  index: z.number().int().min(1),
  heading: z.string().min(1).max(80),
  description: z.string().min(1).max(2000),
  est_minutes: z.number().int().min(0).max(600),
});

/** One recipe. The same shape is reused for the bulk endpoint. */
export const recipeBody = z.object({
  name: z.string().min(1, 'A recipe needs a name').max(120),
  source: z.enum(['seed', 'ai']).optional(),
  status: z.enum(['draft', 'published']).optional(),
  cuisines: z.array(z.string().max(40)).max(8).optional(),
  difficulty: z.enum(['easy', 'medium', 'involved']),
  cook_time_minutes: z.number().int().positive().max(600),
  serves: z.number().int().positive().max(50),
  what_makes_it_good: z.string().min(1, 'Say why anyone would cook it').max(400),
  description: z.string().max(2000).optional(),
  hero_icon: z.string().max(60).nullable().optional(),
  ingredients: z.array(ingredientInput).min(1, 'A recipe needs at least one ingredient').max(60),
  steps: z.array(stepInput).min(1, 'A recipe needs at least one step').max(40),
});

export const CreateRecipeSchema = recipeBody;

/**
 * Editing sends the WHOLE recipe, exactly like creating one.
 *
 * A full replace rather than a patch: ingredients and steps are ordered lists
 * that the form edits as a whole (reorder, insert, remove), and a partial
 * update would have to describe those moves. Sending the lists entire is the
 * only version of this with no merge rules to get wrong.
 */
export const UpdateRecipeSchema = recipeBody;

export const BulkRecipesSchema = z.object({
  // Capped: a paste of five hundred would hold the request open for minutes
  // and is better done as several batches.
  recipes: z.array(recipeBody).min(1, 'Nothing to import').max(100),
});

/** The recipes list's multi-select. Capped like the import above. */
export const DeleteRecipesSchema = z.object({
  ids: z.array(z.string().min(1).max(60)).min(1, 'Nothing selected').max(200),
});

/**
 * The body IS `{ status }`. `validate` parses `req.body` itself, so this was
 * once written with an extra `body:` wrapper that no client ever sent —
 * which rejected every publish and unpublish with "body: Required".
 */
export const SetRecipeStatusSchema = z.object({
  status: z.enum(['draft', 'published']),
});

/** The recipes list's multi-select, publishing or unpublishing in one go. */
export const SetRecipesStatusSchema = z.object({
  ids: z.array(z.string().min(1).max(60)).min(1, 'Nothing selected').max(200),
  status: z.enum(['draft', 'published']),
});

export const ListUsersSchema = z.object({
  search: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
  role: z.string().max(40).optional(),
  ...pagination,
});

export const SetUserStatusSchema = z.object({
  status: z.enum(['active', 'pending', 'suspended', 'banned', 'deleted']),
  /**
   * Why. Optional, but it is emailed to the person and shown in the console —
   * so a suspension with no reason is one nobody can explain later.
   */
  reason: z.string().trim().min(1).max(500).optional(),
});

export const SetUserRoleSchema = z.object({
  role: z.enum(['user', 'moderator', 'admin', 'super_admin']),
});

export const ListAiLogsSchema = z.object({
  prompt_id: z.string().max(80).optional(),
  /** A string on the wire; only "true"/"false" mean anything. */
  ok: z.enum(['true', 'false']).optional(),
  owner_id: z.string().max(60).optional(),
  provider: z.string().max(40).optional(),
  ...pagination,
});

export const ListJobsSchema = z.object({
  status: z.string().max(40).optional(),
  type: z.string().max(60).optional(),
  owner_id: z.string().max(60).optional(),
  ...pagination,
});

export const RetryJobSchema = z.object({
  /** Re-runs a job that already succeeded. Explicit, never a default. */
  force: z.boolean().optional(),
});

const AUDIENCES = ['selected', 'all', 'active', 'pending', 'onboarded', 'not_onboarded'] as const;

export const ComposeEmailSchema = z.object({
  audience: z.enum(AUDIENCES),
  /** Only read when audience is 'selected'. */
  user_ids: z.array(z.string().max(60)).max(2000).optional(),
  subject: z.string().min(1, 'An email needs a subject').max(160),
  body: z.string().min(1, 'An email needs something in it').max(20000),
});

export const PreviewAudienceSchema = z.object({
  audience: z.enum(AUDIENCES),
  user_ids: z.array(z.string().max(60)).max(2000).optional(),
});

export const ListEmailsSchema = z.object({
  kind: z.string().max(60).optional(),
  // 'blocked' is a status a row can actually have, so it has to be filterable —
  // otherwise the console can show blocked mail but never narrow to it.
  status: z.enum(['sent', 'failed', 'suppressed', 'blocked']).optional(),
  provider: z.enum(['resend', 'cloudflare']).optional(),
  to: z.string().max(160).optional(),
  ...pagination,
});

export const SetEmailKindSchema = z.object({
  enabled: z.boolean(),
  /** Why it was switched. Optional, but the console asks for one. */
  reason: z.string().max(300).optional(),
});

export const SetMailProviderSchema = z.object({
  provider: z.enum(['resend', 'cloudflare']),
  /** Why it was switched. Optional, but the console asks for one. */
  reason: z.string().max(300).optional(),
});

export const TestMailProviderSchema = z.object({
  provider: z.enum(['resend', 'cloudflare']),
  /** Where the test goes. An operator's own address, in practice. */
  to: z.string().email('That is not an email address').max(160),
});

export const SetFeatureFlagSchema = z.object({
  enabled: z.boolean(),
  /** Why it was switched. Optional, but the console asks for one. */
  reason: z.string().max(300).optional(),
});
