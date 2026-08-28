import type { Request, Response } from 'express';

import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { requireActor } from '@shared/middleware/authenticate.middleware.js';

import { adminAiService } from './ai/admin-ai.service.js';
import { adminAuthService } from './auth/admin-auth.service.js';
import { adminDashboardService } from './dashboard/admin-dashboard.service.js';
import { adminEmailsService, type ComposeInput } from './emails/admin-emails.service.js';
import { adminJobsService } from './jobs/admin-jobs.service.js';
import { adminRecipesService, type RecipeInput } from './recipes/admin-recipes.service.js';
import { adminUsersService } from './users/admin-users.service.js';

/** Query values arrive as strings; only the ones actually set are forwarded. */
function paging(req: Request): { limit?: number; skip?: number } {
  const query = req.query as { limit?: string; skip?: string };
  return {
    ...(query.limit !== undefined && { limit: Number(query.limit) }),
    ...(query.skip !== undefined && { skip: Number(query.skip) }),
  };
}

export const adminController = {
  // ── Setup ──────────────────────────────────────────────────────────
  setupState: async (_req: Request, res: Response): Promise<void> => {
    const needed = await adminAuthService.needsBootstrap();
    ResponseUtil.ok(res, { needs_setup: needed });
  },

  bootstrap: async (_req: Request, res: Response): Promise<void> => {
    const result = await adminAuthService.bootstrap();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  // ── Dashboard ──────────────────────────────────────────────────────
  overview: async (_req: Request, res: Response): Promise<void> => {
    const result = await adminDashboardService.overview();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  // ── Recipes ────────────────────────────────────────────────────────
  listRecipes: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as { search?: string; status?: string; source?: string };
    const result = await adminRecipesService.list({
      ...(query.search !== undefined && { search: query.search }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.source !== undefined && { source: query.source }),
      ...paging(req),
    });
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  recipeDetail: async (req: Request, res: Response): Promise<void> => {
    const { mealId } = req.params as { mealId: string };
    const result = await adminRecipesService.detail(mealId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  createRecipe: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const result = await adminRecipesService.create(req.body as RecipeInput, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  bulkRecipes: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { recipes } = req.body as { recipes: RecipeInput[] };
    const result = await adminRecipesService.createBulk(recipes, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  setRecipeStatus: async (req: Request, res: Response): Promise<void> => {
    const { mealId } = req.params as { mealId: string };
    const { status } = req.body as { status: 'draft' | 'published' };
    const result = await adminRecipesService.setStatus(mealId, status);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  deleteRecipe: async (req: Request, res: Response): Promise<void> => {
    const { mealId } = req.params as { mealId: string };
    const result = await adminRecipesService.remove(mealId);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  // ── Users ──────────────────────────────────────────────────────────
  listUsers: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as { search?: string; status?: string; role?: string };
    const result = await adminUsersService.list({
      ...(query.search !== undefined && { search: query.search }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.role !== undefined && { role: query.role }),
      ...paging(req),
    });
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  userDetail: async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params as { userId: string };
    const result = await adminUsersService.detail(userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  setUserStatus: async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params as { userId: string };
    const { status } = req.body as { status: string };
    const result = await adminUsersService.setStatus(userId, status);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  setUserRole: async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params as { userId: string };
    const { role } = req.body as { role: string };
    const result = await adminUsersService.setRole(userId, role);
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  // ── AI audit ───────────────────────────────────────────────────────
  listAiLogs: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as {
      prompt_id?: string;
      ok?: string;
      owner_id?: string;
      provider?: string;
    };
    const result = await adminAiService.list({
      ...(query.prompt_id !== undefined && { promptId: query.prompt_id }),
      ...(query.ok !== undefined && { ok: query.ok === 'true' }),
      ...(query.owner_id !== undefined && { ownerId: query.owner_id }),
      ...(query.provider !== undefined && { provider: query.provider }),
      ...paging(req),
    });
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  aiLogDetail: async (req: Request, res: Response): Promise<void> => {
    const { logId } = req.params as { logId: string };
    const result = await adminAiService.detail(logId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  aiPromptIds: async (_req: Request, res: Response): Promise<void> => {
    const result = await adminAiService.promptIds();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  // ── Email ──────────────────────────────────────────────────────────
  previewAudience: async (req: Request, res: Response): Promise<void> => {
    const { audience, user_ids: userIds } = req.body as {
      audience: ComposeInput['audience'];
      user_ids?: string[];
    };
    const result = await adminEmailsService.preview({
      audience,
      ...(userIds !== undefined && { userIds }),
    });
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  sendEmail: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const body = req.body as {
      audience: ComposeInput['audience'];
      user_ids?: string[];
      subject: string;
      body: string;
    };
    const result = await adminEmailsService.send(
      {
        audience: body.audience,
        ...(body.user_ids !== undefined && { userIds: body.user_ids }),
        subject: body.subject,
        body: body.body,
      },
      actor.userId,
    );
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  listEmails: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as { kind?: string; status?: string; to?: string };
    const result = await adminEmailsService.list({
      ...(query.kind !== undefined && { kind: query.kind }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.to !== undefined && { to: query.to }),
      ...paging(req),
    });
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  emailDetail: async (req: Request, res: Response): Promise<void> => {
    const { emailId } = req.params as { emailId: string };
    const result = await adminEmailsService.detail(emailId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  resendEmail: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { emailId } = req.params as { emailId: string };
    const result = await adminEmailsService.resend(emailId, actor.userId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  emailSettings: async (_req: Request, res: Response): Promise<void> => {
    const result = await adminEmailsService.settings();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  setEmailKind: async (req: Request, res: Response): Promise<void> => {
    const actor = requireActor(req);
    const { kind } = req.params as { kind: string };
    const { enabled, reason } = req.body as { enabled: boolean; reason?: string };
    const result = await adminEmailsService.setKindEnabled(
      kind as never,
      enabled,
      actor.userId,
      reason,
    );
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  emailKinds: async (_req: Request, res: Response): Promise<void> => {
    const result = await adminEmailsService.kinds();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  // ── Jobs ───────────────────────────────────────────────────────────
  listJobs: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as { status?: string; type?: string; owner_id?: string };
    const result = await adminJobsService.list({
      ...(query.status !== undefined && { status: query.status }),
      ...(query.type !== undefined && { type: query.type }),
      ...(query.owner_id !== undefined && { ownerId: query.owner_id }),
      ...paging(req),
    });
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  jobDetail: async (req: Request, res: Response): Promise<void> => {
    const { jobId } = req.params as { jobId: string };
    const result = await adminJobsService.detail(jobId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  retryJob: async (req: Request, res: Response): Promise<void> => {
    const { jobId } = req.params as { jobId: string };
    const { force } = req.body as { force?: boolean };
    const result = await adminJobsService.retry(jobId, force ?? false);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  cancelJob: async (req: Request, res: Response): Promise<void> => {
    const { jobId } = req.params as { jobId: string };
    const result = await adminJobsService.cancel(jobId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  jobTypes: async (_req: Request, res: Response): Promise<void> => {
    const result = await adminJobsService.types();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },
};
