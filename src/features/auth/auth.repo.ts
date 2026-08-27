import {
  SessionModel,
  type RevokedReason,
  type SessionDocument,
} from '@features/auth/auth.model.js';
import { UserModel, type UserDocument } from '@features/users/users.model.js';
import type { UserRole, UserStatus } from '@shared/constants/roles.js';

/**
 * Data access only. No business decisions live here — whether a locked account
 * may log in is the service's call, not this layer's.
 */
export class AuthRepository {
  private static instance: AuthRepository | undefined;

  static getInstance(): AuthRepository {
    AuthRepository.instance ??= new AuthRepository();
    return AuthRepository.instance;
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return UserModel.findOne({ email }).exec();
  }

  /**
   * The hash is `select: false` on the schema, so it must be asked for
   * explicitly. That is the point: it is opted into here, in the one place
   * that verifies a password, rather than being present everywhere by default.
   */
  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return UserModel.findOne({ email }).select('+passwordHash').exec();
  }

  findByIdWithPassword(userId: string): Promise<UserDocument | null> {
    return UserModel.findById(userId).select('+passwordHash').exec();
  }

  findById(userId: string): Promise<UserDocument | null> {
    return UserModel.findById(userId).exec();
  }

  createUser(input: {
    email: string;
    passwordHash: string;
    name: string;
    role: UserRole;
    status: UserStatus;
  }): Promise<UserDocument> {
    return UserModel.create(input);
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await UserModel.updateOne({ _id: userId }, { $set: { passwordHash } }).exec();
  }

  async recordSuccessfulLogin(userId: string): Promise<void> {
    await UserModel.updateOne(
      { _id: userId },
      { $set: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } },
    ).exec();
  }

  /**
   * Increments and locks in one atomic update, returning the new document.
   * Read-then-write would race under concurrent guesses and undercount.
   */
  async recordFailedLogin(userId: string, lockUntil: Date | null): Promise<number> {
    const updated = await UserModel.findOneAndUpdate(
      { _id: userId },
      {
        $inc: { failedLoginCount: 1 },
        ...(lockUntil !== null && { $set: { lockedUntil: lockUntil } }),
      },
      { new: true },
    ).exec();

    return updated?.failedLoginCount ?? 0;
  }

  async clearLock(userId: string): Promise<void> {
    await UserModel.updateOne(
      { _id: userId },
      { $set: { failedLoginCount: 0, lockedUntil: null } },
    ).exec();
  }

  createSession(input: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  }) {
    return SessionModel.create(input);
  }

  findSessionByHash(refreshTokenHash: string): Promise<SessionDocument | null> {
    return SessionModel.findOne({ refreshTokenHash }).exec();
  }

  async revokeSession(
    sessionId: string,
    replacedBySessionId: string | null,
    reason: RevokedReason,
  ): Promise<void> {
    await SessionModel.updateOne(
      { _id: sessionId, revokedAt: null },
      { $set: { revokedAt: new Date(), replacedBySessionId, revokedReason: reason } },
    ).exec();
  }

  /** Used on reuse detection, password change, and ban. */
  async revokeAllSessionsForUser(userId: string, reason: RevokedReason): Promise<number> {
    const result = await SessionModel.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: reason } },
    ).exec();
    return result.modifiedCount;
  }
}

export const authRepository = AuthRepository.getInstance();
