import { UserModel, type UserDocument } from '@features/users/users.model.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { CUISINE_OPTIONS } from '@shared/constants/roles.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import type { SaveOnboardingInput } from './onboarding.schema.js';
import { toOnboardingView, type OnboardingView } from './onboarding.types.js';

export class OnboardingService {
  private static instance: OnboardingService | undefined;

  static getInstance(): OnboardingService {
    OnboardingService.instance ??= new OnboardingService();
    return OnboardingService.instance;
  }

  async get(userId: string): Promise<ServiceResult<OnboardingView>> {
    const user = await UserModel.findById(userId).exec();
    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(toOnboardingView(user, CUISINE_OPTIONS));
  }

  /**
   * Saves one step's answers.
   *
   * Builds a `$set` of only the fields that were actually sent, so a step that
   * collects cuisines cannot blank the kitchen list a later step will fill.
   */
  async save(userId: string, input: SaveOnboardingInput): Promise<ServiceResult<OnboardingView>> {
    const update: Record<string, unknown> = {};

    if (input.cuisines !== undefined) update['prefs.cuisines'] = input.cuisines;
    if (input.difficulty !== undefined) update['prefs.difficulty'] = input.difficulty;
    if (input.measurement !== undefined) update['prefs.measurement'] = input.measurement;

    if (input.kitchen_items !== undefined) {
      // De-duplicated case-insensitively, keeping the spelling the cook used —
      // "Rice" and "rice" are one thing, and it is not our place to re-case it.
      const seen = new Set<string>();
      const items: string[] = [];
      for (const item of input.kitchen_items) {
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
      update['kitchenItems'] = items;
    }

    const user = await UserModel.findOneAndUpdate(
      { _id: userId },
      { $set: update },
      { new: true },
    ).exec();

    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    return ok(toOnboardingView(user, CUISINE_OPTIONS));
  }

  /**
   * Marks onboarding finished.
   *
   * Completing twice is refused rather than silently re-stamped: the timestamp
   * is a real fact about when someone joined, and quietly moving it would lose
   * that. The client treats the conflict as "already done, carry on".
   */
  async complete(userId: string): Promise<ServiceResult<OnboardingView>> {
    const user: UserDocument | null = await UserModel.findById(userId).exec();
    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    if (user.onboardingCompletedAt !== null) {
      return fail(
        ERROR_CODES.ONBOARDING_ALREADY_COMPLETED,
        MESSAGE_KEYS.onboarding.ALREADY_COMPLETED,
        HTTP_STATUS.CONFLICT,
        { rejectionReason: 'onboarding_already_completed' },
      );
    }

    const updated = await UserModel.findOneAndUpdate(
      { _id: userId, onboardingCompletedAt: null },
      { $set: { onboardingCompletedAt: new Date() } },
      { new: true },
    ).exec();

    // Lost a race with a concurrent complete — the outcome the caller wanted
    // still happened, so report it as done rather than as an error.
    if (updated === null) {
      const fresh = await UserModel.findById(userId).exec();
      if (fresh === null) {
        return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
      }
      return ok(toOnboardingView(fresh, CUISINE_OPTIONS));
    }

    logger.info('onboarding completed', { user_id: userId });
    return ok(toOnboardingView(updated, CUISINE_OPTIONS));
  }
}

export const onboardingService = OnboardingService.getInstance();
