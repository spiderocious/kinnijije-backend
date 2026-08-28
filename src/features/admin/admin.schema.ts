import { z } from 'zod';

const pagination = {
  limit: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
};

export const ListRecipesSchema = z.object({
  query: z.object({
    search: z.string().max(120).optional(),
    status: z.enum(['draft', 'published']).optional(),
    source: z.enum(['seed', 'ai']).optional(),
    ...pagination,
  }),
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

export const CreateRecipeSchema = z.object({ body: recipeBody });

export const BulkRecipesSchema = z.object({
  body: z.object({
    // Capped: a paste of five hundred would hold the request open for minutes
    // and is better done as several batches.
    recipes: z.array(recipeBody).min(1, 'Nothing to import').max(100),
  }),
});

export const SetRecipeStatusSchema = z.object({
  body: z.object({ status: z.enum(['draft', 'published']) }),
});

export const ListUsersSchema = z.object({
  query: z.object({
    search: z.string().max(120).optional(),
    status: z.string().max(40).optional(),
    role: z.string().max(40).optional(),
    ...pagination,
  }),
});

export const SetUserStatusSchema = z.object({
  body: z.object({
    status: z.enum(['active', 'pending', 'suspended', 'banned', 'deleted']),
  }),
});

export const SetUserRoleSchema = z.object({
  body: z.object({
    role: z.enum(['user', 'moderator', 'admin', 'super_admin']),
  }),
});

export const ListAiLogsSchema = z.object({
  query: z.object({
    prompt_id: z.string().max(80).optional(),
    /** A string on the wire; only "true"/"false" mean anything. */
    ok: z.enum(['true', 'false']).optional(),
    owner_id: z.string().max(60).optional(),
    provider: z.string().max(40).optional(),
    ...pagination,
  }),
});

export const ListJobsSchema = z.object({
  query: z.object({
    status: z.string().max(40).optional(),
    type: z.string().max(60).optional(),
    owner_id: z.string().max(60).optional(),
    ...pagination,
  }),
});

export const RetryJobSchema = z.object({
  body: z.object({
    /** Re-runs a job that already succeeded. Explicit, never a default. */
    force: z.boolean().optional(),
  }),
});

const AUDIENCES = ['selected', 'all', 'active', 'pending', 'onboarded', 'not_onboarded'] as const;

export const ComposeEmailSchema = z.object({
  body: z.object({
    audience: z.enum(AUDIENCES),
    /** Only read when audience is 'selected'. */
    user_ids: z.array(z.string().max(60)).max(2000).optional(),
    subject: z.string().min(1, 'An email needs a subject').max(160),
    body: z.string().min(1, 'An email needs something in it').max(20000),
  }),
});

export const PreviewAudienceSchema = z.object({
  body: z.object({
    audience: z.enum(AUDIENCES),
    user_ids: z.array(z.string().max(60)).max(2000).optional(),
  }),
});

export const ListEmailsSchema = z.object({
  query: z.object({
    kind: z.string().max(60).optional(),
    status: z.enum(['sent', 'failed', 'suppressed']).optional(),
    to: z.string().max(160).optional(),
    ...pagination,
  }),
});

export const SetEmailKindSchema = z.object({
  body: z.object({
    enabled: z.boolean(),
    /** Why it was switched. Optional, but the console asks for one. */
    reason: z.string().max(300).optional(),
  }),
});
