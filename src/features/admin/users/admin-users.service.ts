import { ChatMessageModel } from '@features/chat/chat.model.js';
import { isoOrNull } from '@lib/dates.js';
import { FileModel } from '@features/files/files.model.js';
import { MarketItemModel } from '@features/market/market.model.js';
import { CookedMealModel, FavouriteModel } from '@features/meals/meals.model.js';
import { StockItemModel } from '@features/stock/stock.model.js';
import { UserModel } from '@features/users/users.model.js';
import { usersService } from '@features/users/users.service.js';
import { record } from '@lib/audit/index.js';
import { AiLogModel } from '@lib/ai/ai-log.model.js';
import { JobModel } from '@lib/jobs/jobs.model.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';
import { USER_STATUSES, type UserStatus } from '@shared/constants/roles.js';

/**
 * The people half of the console.
 *
 * The detail view pulls EVERYTHING one person has — kitchen, market list,
 * cooking history, AI spend — because the reason to open a single account is
 * almost always "something looks wrong for this one person", and hunting it
 * across six screens is how that goes unanswered.
 */
export class AdminUsersService {
  private static instance: AdminUsersService | undefined;

  static getInstance(): AdminUsersService {
    AdminUsersService.instance ??= new AdminUsersService();
    return AdminUsersService.instance;
  }

  async list(query: {
    search?: string;
    status?: string;
    role?: string;
    limit?: number;
    skip?: number;
  }): Promise<ServiceResult<{ items: unknown[]; total: number }>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter['status'] = query.status;
    if (query.search !== undefined && query.search.length > 0) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter['$or'] = [
        { email: { $regex: escaped, $options: 'i' } },
        { name: { $regex: escaped, $options: 'i' } },
      ];
    }

    const limit = Math.min(query.limit ?? 50, 200);
    const [rows, total] = await Promise.all([
      UserModel.find(filter).sort({ createdAt: -1 }).skip(query.skip ?? 0).limit(limit).exec(),
      UserModel.countDocuments(filter).exec(),
    ]);

    return ok({
      items: rows.map((user) => ({
        id: user._id,
        email: user.email,
        name: user.name,
        status: user.status,
        has_onboarded: user.onboardingCompletedAt !== null,
        email_verified: user.emailVerifiedAt !== null,
        created_at: isoOrNull(user.createdAt),
      })),
      total,
    });
  }

  /** One person, and everything of theirs. */
  async detail(userId: string): Promise<ServiceResult<unknown>> {
    const user = await UserModel.findById(userId).exec();
    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const [stock, market, cooked, favourites, chatCount, jobs, aiSpend, files] = await Promise.all([
      StockItemModel.find({ ownerId: userId }).sort({ updatedAt: -1 }).limit(200).exec(),
      MarketItemModel.find({ ownerId: userId }).sort({ createdAt: -1 }).limit(100).exec(),
      CookedMealModel.find({ ownerId: userId }).sort({ cookedAt: -1 }).limit(50).exec(),
      FavouriteModel.countDocuments({ ownerId: userId }).exec(),
      ChatMessageModel.countDocuments({ ownerId: userId }).exec(),
      JobModel.find({ ownerId: userId }).sort({ createdAt: -1 }).limit(25).exec(),
      AiLogModel.aggregate<{ _id: null; calls: number; tokens: number; failed: number }>([
        { $match: { ownerId: userId } },
        {
          $group: {
            _id: null,
            calls: { $sum: 1 },
            tokens: { $sum: '$totalTokens' },
            failed: { $sum: { $cond: ['$ok', 0, 1] } },
          },
        },
      ]).exec(),
      FileModel.countDocuments({ ownerId: userId }).exec(),
    ]);

    const spend = aiSpend[0];

    return ok({
      account: {
        id: user._id,
        email: user.email,
        name: user.name,
        status: user.status,
        has_onboarded: user.onboardingCompletedAt !== null,
        email_verified_at: isoOrNull(user.emailVerifiedAt),
        created_at: isoOrNull(user.createdAt),
        updated_at: isoOrNull(user.updatedAt),
      },
      totals: {
        stock_items: stock.length,
        market_items: market.length,
        cooked: cooked.length,
        favourites,
        chat_messages: chatCount,
        files,
        ai_calls: spend?.calls ?? 0,
        ai_failed: spend?.failed ?? 0,
        ai_tokens: Math.round(spend?.tokens ?? 0),
      },
      stock: stock.map((item) => ({
        id: item._id,
        name: item.name,
        catalogue_id: item.catalogueId,
        quantity: item.quantity,
        unit: item.unit,
        updated_at: isoOrNull(item.updatedAt),
      })),
      market: market.map((item) => ({
        id: item._id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        bought: item.boughtAt !== null,
        created_at: isoOrNull(item.createdAt),
      })),
      cooked: cooked.map((row) => ({
        meal_id: row.mealId,
        meal_name: row.mealName,
        cooked_at: isoOrNull(row.cookedAt),
      })),
      jobs: jobs.map((job) => ({
        id: job._id,
        type: job.type,
        status: job.status,
        created_at: isoOrNull(job.createdAt),
      })),
    });
  }

  /**
   * Whether this change would remove the last super admin who can act.
   *
   * Counts everyone EXCEPT the target, so "is there somebody else?" is the
   * question actually being asked.
   */
  private async wouldOrphanConsole(targetUserId: string): Promise<boolean> {
    const target = await UserModel.findById(targetUserId, { role: 1, status: 1 }).lean().exec();
    if (target === null) return false;
    // Console orphaning is a STAFF concern now — see staffService. A customer
    // account cannot be the last administrator of anything.
    return false;
  }

  /**
   * Status change, from the console.
   *
   * Delegates to `usersService.updateStatus`, which is the ONE implementation
   * that checks the transition map, revokes sessions when the new status
   * cannot hold one, and emails the person. This service previously ran its
   * own bare `updateOne`, which meant the console could make transitions the
   * map forbids — `deleted → active` among them — and left the target holding
   * a live session after being banned.
   */
  async setStatus(
    targetUserId: string,
    status: UserStatus,
    actingUserId: string,
    reason: string | null = null,
  ): Promise<ServiceResult<null>> {
    if (targetUserId === actingUserId) {
      return fail(
        ERROR_CODES.FORBIDDEN,
        MESSAGE_KEYS.access.FORBIDDEN,
        HTTP_STATUS.FORBIDDEN,
        { rejectionReason: 'self_status_change' },
      );
    }

    // A status that cannot hold a session removes an active super admin as
    // surely as a demotion does.
    if (status !== USER_STATUSES.ACTIVE && (await this.wouldOrphanConsole(targetUserId))) {
      return fail(
        ERROR_CODES.FORBIDDEN,
        MESSAGE_KEYS.access.FORBIDDEN,
        HTTP_STATUS.FORBIDDEN,
        { rejectionReason: 'last_super_admin' },
      );
    }

    // Read BEFORE the change so the trail carries what it said before — a
    // record without the old value cannot answer the question people ask.
    const before = await UserModel.findById(targetUserId, { status: 1 }).lean().exec();

    const result = await usersService.updateStatus(targetUserId, status, reason);
    if (!result.success) return result;

    record({
      action: 'users.status.changed',
      resource: 'users',
      resourceId: targetUserId,
      changes: [{ field: 'status', from: before?.status ?? null, to: status }],
      meta: reason === null ? null : { reason },
    });

    return ok(null);
  }

}

/**
 * NOTE: there is no `setRole` here any more.
 *
 * A customer account has no role — console access is a `staff_users` row, and
 * a staff member's tier is managed by `staff.service`. That removes the
 * privilege-escalation path this method used to be: it was a bare `updateOne`
 * that let any admin promote themselves to super admin.
 */

export const adminUsersService = AdminUsersService.getInstance();
