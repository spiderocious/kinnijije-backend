import { UserModel } from '@features/users/users.model.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import type { SaveKitchenInput } from './kitchen.schema.js';
import { RECENT_HISTORY_LIMIT, toKitchenView, type KitchenView } from './kitchen.types.js';

export class KitchenService {
  private static instance: KitchenService | undefined;

  static getInstance(): KitchenService {
    KitchenService.instance ??= new KitchenService();
    return KitchenService.instance;
  }

  async get(userId: string): Promise<ServiceResult<KitchenView>> {
    const user = await UserModel.findById(userId).exec();
    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(toKitchenView(user));
  }

  /**
   * Replaces the basket, and folds what was added into the recents.
   *
   * Recents are a side-effect of using the product, never a thing anyone
   * maintains — the same principle the standing kitchen runs on. Newest first,
   * de-duplicated case-insensitively, and capped so the list cannot grow
   * without bound.
   */
  async save(userId: string, input: SaveKitchenInput): Promise<ServiceResult<KitchenView>> {
    const user = await UserModel.findById(userId).exec();
    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const items = dedupe(input.items);
    // Current basket first, then whatever was already remembered.
    const recent = dedupe([...items, ...(user.recentIngredients ?? [])]).slice(
      0,
      RECENT_HISTORY_LIMIT,
    );

    const updated = await UserModel.findOneAndUpdate(
      { _id: userId },
      { $set: { kitchenItems: items, recentIngredients: recent } },
      { new: true },
    ).exec();

    if (updated === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    return ok(toKitchenView(updated));
  }
}

/**
 * Case-insensitive de-duplication that KEEPS the spelling the cook used.
 * "Rice" and "rice" are one ingredient, and it is not our place to re-case
 * somebody's word.
 */
function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export const kitchenService = KitchenService.getInstance();
