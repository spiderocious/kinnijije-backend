import type { Request, Response } from 'express';

import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';

import { FEATURE_FLAGS, flagsService, type FeatureFlag } from '@lib/flags/index.js';
import { ResponseUtil } from '@lib/response.js';
import { bail } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';
// The STAFF actor. Every route this controller serves is behind
// `authenticateStaff`, which sets `req.staff`; the customer `requireActor`
// reads `req.actor`, which is never set here, and 401'd every write.
import { requireStaff } from '@shared/middleware/authenticate-staff.middleware.js';
import type { UserStatus } from '@shared/constants/roles.js';
import {
  DEFAULT_RANKING_CONFIG,
  RANKING_CONFIG_ID,
  RankingSettingsModel,
  rankingSettings,
  resolveRankingConfig,
} from '@lib/ranking/index.js';

import { adminAiService } from './ai/admin-ai.service.js';
import { adminAuthService } from './auth/admin-auth.service.js';
import { adminDashboardService } from './dashboard/admin-dashboard.service.js';
import { adminAiStatsService } from './ai/admin-ai-stats.service.js';
import { adminDecideService } from './decide/admin-decide.service.js';
import type { MailProvider } from '@lib/mail/index.js';

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
    const actor = requireStaff(req);
    const result = await adminRecipesService.create(req.body as RecipeInput, actor.staffId);
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  bulkRecipes: async (req: Request, res: Response): Promise<void> => {
    const actor = requireStaff(req);
    const { recipes } = req.body as { recipes: RecipeInput[] };
    const result = await adminRecipesService.createBulk(recipes, actor.staffId);
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

  setRecipesStatus: async (req: Request, res: Response): Promise<void> => {
    const { ids, status } = req.body as { ids: string[]; status: 'draft' | 'published' };
    const result = await adminRecipesService.setStatusMany(ids, status);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  deleteRecipes: async (req: Request, res: Response): Promise<void> => {
    const { ids } = req.body as { ids: string[] };
    const result = await adminRecipesService.removeMany(ids);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
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
    const actor = requireStaff(req);
    const { userId } = req.params as { userId: string };
    const { status, reason } = req.body as { status: UserStatus; reason?: string };
    const result = await adminUsersService.setStatus(
      userId,
      status,
      actor.staffId,
      reason ?? null,
    );
    if (!result.success) return bail(result);

    // Moderation load, and it keeps the `status` profile property honest so
    // suspended accounts can be excluded from engagement reports.
    analytics.track(SERVER_EVENTS.ACCOUNT_STATUS_CHANGED, userId, {
      to_status: status,
      changed_by: 'admin',
    });
    analytics.setProfile(userId, { status });

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

  // ── Features ───────────────────────────────────────────────────────
  featureFlags: async (_req: Request, res: Response): Promise<void> => {
    ResponseUtil.ok(res, await flagsService.listForConsole());
  },

  setFeatureFlag: async (req: Request, res: Response): Promise<void> => {
    const actor = requireStaff(req);
    const { flag } = req.params as { flag: string };
    const { enabled, reason } = req.body as { enabled: boolean; reason?: string };

    // The key is checked against the KNOWN flags — an unknown one would write a
    // row nothing ever reads, which looks switched off and is not.
    if (!(Object.values(FEATURE_FLAGS) as string[]).includes(flag)) {
      return bail({
        success: false,
        code: ERROR_CODES.NOT_FOUND,
        messageKey: MESSAGE_KEYS.common.NOT_FOUND,
        httpStatus: HTTP_STATUS.NOT_FOUND,
        rejectionReason: 'unknown_feature_flag',
      });
    }

    await flagsService.set(flag as FeatureFlag, enabled, actor.staffId, reason);
    ResponseUtil.noContent(res);
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
    const actor = requireStaff(req);
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
      actor.staffId,
    );
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  listEmails: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as {
      kind?: string;
      status?: string;
      provider?: string;
      to?: string;
    };
    const result = await adminEmailsService.list({
      ...(query.kind !== undefined && { kind: query.kind }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.provider !== undefined && { provider: query.provider }),
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
    const actor = requireStaff(req);
    const { emailId } = req.params as { emailId: string };
    const result = await adminEmailsService.resend(emailId, actor.staffId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  emailSettings: async (_req: Request, res: Response): Promise<void> => {
    const result = await adminEmailsService.settings();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  setEmailKind: async (req: Request, res: Response): Promise<void> => {
    const actor = requireStaff(req);
    const { kind } = req.params as { kind: string };
    const { enabled, reason } = req.body as { enabled: boolean; reason?: string };
    const result = await adminEmailsService.setKindEnabled(
      kind as never,
      enabled,
      actor.staffId,
      reason,
    );
    if (!result.success) return bail(result);
    ResponseUtil.noContent(res);
  },

  mailProvider: async (_req: Request, res: Response): Promise<void> => {
    const result = await adminEmailsService.provider();
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  setMailProvider: async (req: Request, res: Response): Promise<void> => {
    const actor = requireStaff(req);
    const { provider, reason } = req.body as { provider: MailProvider; reason?: string };
    const result = await adminEmailsService.setProvider(provider, actor.staffId, reason);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  testMailProvider: async (req: Request, res: Response): Promise<void> => {
    const actor = requireStaff(req);
    const { provider, to } = req.body as { provider: MailProvider; to: string };
    const result = await adminEmailsService.testProvider(provider, to, actor.staffId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
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

  /**
   * How ranking is tuned.
   *
   * Returns the live config alongside the shipped defaults, so the console can
   * show what has been changed and offer a reset without hardcoding a copy of
   * the numbers.
   */
  rankingConfig: async (_req: Request, res: Response): Promise<void> => {
    const doc = await RankingSettingsModel.findById(RANKING_CONFIG_ID).lean().exec();
    ResponseUtil.ok(res, {
      config: resolveRankingConfig(doc?.config ?? null),
      defaults: DEFAULT_RANKING_CONFIG,
      updated_at: doc?.updatedAt ?? null,
      updated_by: doc?.updatedBy ?? null,
    });
  },

  /**
   * Saves tuned weights.
   *
   * The body is merged over the defaults and VALIDATED before it is stored, so
   * a bad value is refused at the door rather than quietly ranking everything
   * to zero. The in-memory cache is invalidated so the change is visible on the
   * next request rather than up to a minute later.
   */
  saveRankingConfig: async (req: Request, res: Response): Promise<void> => {
    const actor = requireStaff(req);
    const merged = resolveRankingConfig(req.body);

    await RankingSettingsModel.findOneAndUpdate(
      { _id: RANKING_CONFIG_ID },
      { $set: { config: merged, updatedBy: actor.staffId } },
      { upsert: true, new: true },
    ).exec();

    rankingSettings.invalidate();
    ResponseUtil.ok(res, { config: merged });
  },


  /** Everything the console knows about the decide flow, aggregated. */
  decideOverview: async (req: Request, res: Response): Promise<void> => {
    const { days } = req.query as { days?: string };
    const result = await adminDecideService.overview(
      days !== undefined ? Math.min(Math.max(Number(days), 1), 90) : 14,
    );
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  /** The raw log: every submission and every answer, newest first. */
  decideLogs: async (req: Request, res: Response): Promise<void> => {
    const query = req.query as {
      mood?: string;
      provenance?: string;
      empty?: string;
    };

    const result = await adminDecideService.list({
      ...paging(req),
      ...(query.mood !== undefined && { mood: query.mood }),
      ...(query.provenance !== undefined && { provenance: query.provenance }),
      ...(query.empty === 'true' && { emptyOnly: true }),
    });
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },


  /** One decision, in full. */
  decideLog: async (req: Request, res: Response): Promise<void> => {
    const { logId } = req.params as { logId: string };
    const result = await adminDecideService.detail(logId);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },


  /** Cost, health and volume for every prompt. Aggregated from `ai_logs`. */
  aiStats: async (req: Request, res: Response): Promise<void> => {
    const { days } = req.query as { days?: string };
    const window = days === undefined ? 30 : Math.min(Math.max(Number(days) || 30, 1), 90);
    const result = await adminAiStatsService.stats(window);
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

};
