import type { Difficulty, UserRole, UserStatus } from '@shared/constants/roles.js';

import type { UserDocument } from './users.model.js';

/**
 * The wire shape of a user. Snake_case, matching the rest of the envelope.
 *
 * This mapper is the contract: it is deliberately the only path from a
 * document to a response, so a field added to the model is not published by
 * accident. `passwordHash` cannot leak through it even if a query selects it.
 */
export interface UserView {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  email_verified_at: string | null;
  last_login_at: string | null;
  /**
   * Null until they finish setting up. The web app routes on this rather than
   * on anything it stores locally — the server owns the answer.
   */
  onboarding_completed_at: string | null;
  /** Convenience mirror of the above, so a client does not have to null-check a date. */
  has_onboarded: boolean;
  prefs: {
    cuisines: string[];
    difficulty: Difficulty;
    measurement: 'metric' | 'imperial';
  };
  created_at: string;
  updated_at: string;
}

export const toUserView = (doc: UserDocument): UserView => ({
  id: doc._id,
  email: doc.email,
  name: doc.name,
  role: doc.role,
  status: doc.status,
  // Dates cross the wire as ISO-8601 UTC, always. The conversion belongs here,
  // in the mapper, not at each callsite.
  email_verified_at: doc.emailVerifiedAt?.toISOString() ?? null,
  last_login_at: doc.lastLoginAt?.toISOString() ?? null,
  onboarding_completed_at: doc.onboardingCompletedAt?.toISOString() ?? null,
  has_onboarded: doc.onboardingCompletedAt !== null,
  prefs: {
    cuisines: doc.prefs?.cuisines ?? [],
    difficulty: doc.prefs?.difficulty ?? 'anything',
    measurement: doc.prefs?.measurement ?? 'metric',
  },
  created_at: doc.createdAt.toISOString(),
  updated_at: doc.updatedAt.toISOString(),
});
