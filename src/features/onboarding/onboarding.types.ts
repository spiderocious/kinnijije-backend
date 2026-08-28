import type { Difficulty } from '@shared/constants/roles.js';
import { isoOrNull } from '@lib/dates.js';

import type { UserDocument } from '@features/users/users.model.js';

/**
 * What the client needs to render and resume onboarding.
 *
 * `completed` is the server's answer to "should I show onboarding" — the client
 * never decides this for itself.
 */
export interface OnboardingView {
  completed: boolean;
  completed_at: string | null;
  cuisines: string[];
  difficulty: Difficulty;
  measurement: 'metric' | 'imperial';
  kitchen_items: string[];
  /** The options the UI should offer, so the list lives in one place. */
  available_cuisines: readonly string[];
}

export const toOnboardingView = (
  doc: UserDocument,
  availableCuisines: readonly string[],
): OnboardingView => ({
  completed: doc.onboardingCompletedAt !== null,
  completed_at: isoOrNull(doc.onboardingCompletedAt),
  cuisines: doc.prefs?.cuisines ?? [],
  difficulty: doc.prefs?.difficulty ?? 'anything',
  measurement: doc.prefs?.measurement ?? 'metric',
  kitchen_items: doc.kitchenItems ?? [],
  available_cuisines: availableCuisines,
});
