import argon2 from 'argon2';

import type { AuthRepository } from '@features/auth/auth.repo.js';
import { authRepository } from '@features/auth/auth.repo.js';
import { toUserView, type UserView } from '@features/users/users.types.js';
import { logger } from '@lib/logger/index.js';
import { randomBytes } from 'node:crypto';

import { EMAIL_KINDS, emailService } from '@lib/mail/index.js';
import {
  passwordChangedEmail,
  passwordResetEmail,
  welcomeEmail,
} from '@lib/mail/templates.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenTtlSeconds,
  signAccessToken,
  accessTokenTtlSeconds,
} from '@lib/tokens.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import {
  SESSION_ALLOWED_STATUSES,
  USER_ROLES,
  USER_STATUSES,
  type UserRole,
  type UserStatus,
} from '@shared/constants/roles.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import type { ChangePasswordInput, LoginInput, RegisterInput } from './auth.schema.js';
import { PasswordResetModel } from './password-reset.model.js';

/** After this many consecutive failures the account locks for the cooldown below. */
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

interface IssuedSession {
  sessionId: string;
  tokens: AuthTokens;
}

export interface AuthSessionResult {
  user: UserView;
  tokens: AuthTokens;
}

/** Where the request came from. Not `req` — just the two fields worth storing. */
export interface SessionOrigin {
  userAgent: string | null;
  ip: string | null;
}

/** How long a reset link stays good. Short, because it is a key by email. */
const RESET_TTL_MINUTES = 60;

export class AuthService {
  private constructor(
    private readonly repo: AuthRepository = authRepository,
  ) {}

  private static instance: AuthService | undefined;

  static getInstance(): AuthService {
    AuthService.instance ??= new AuthService();
    return AuthService.instance;
  }

  async register(
    input: RegisterInput,
    origin: SessionOrigin,
  ): Promise<ServiceResult<AuthSessionResult>> {
    const existing = await this.repo.findByEmail(input.email);
    if (existing !== null) {
      return fail(
        ERROR_CODES.EMAIL_EXISTS,
        MESSAGE_KEYS.auth.EMAIL_EXISTS,
        HTTP_STATUS.CONFLICT,
        { fieldErrors: { email: ['An account with that email already exists'] } },
      );
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    let user;
    try {
      user = await this.repo.createUser({
        email: input.email,
        passwordHash,
        name: input.name,
        role: USER_ROLES.USER,
        // New accounts start unverified. Status gating is what makes that
        // mean something: PENDING can read, but not act.
        status: USER_STATUSES.PENDING,
        // Only when they gave one — an empty string would look like an answer
        // and break the weather lookup.
        ...(input.city !== undefined && input.city.length > 0 && { city: input.city }),
      });
    } catch (error) {
      // The unique index is the real guard. The check above is a nicety that
      // loses to a concurrent registration, and the index catches that race.
      if (isDuplicateKeyError(error)) {
        return fail(ERROR_CODES.EMAIL_EXISTS, MESSAGE_KEYS.auth.EMAIL_EXISTS, HTTP_STATUS.CONFLICT, {
          fieldErrors: { email: ['An account with that email already exists'] },
        });
      }
      throw error;
    }

    const issued = await this.issueSession(
      user._id,
      user.role,
      user.status,
      origin,
    );

    // Best-effort, and not awaited: a slow mail provider must not slow a
    // signup, and a bounced welcome email must not fail one.
    emailService.dispatch({
      kind: EMAIL_KINDS.WELCOME,
      to: user.email,
      ownerId: user._id,
      content: welcomeEmail(user.name),
    });

    return ok({ user: toUserView(user), tokens: issued.tokens });
  }

  async login(input: LoginInput, origin: SessionOrigin): Promise<ServiceResult<AuthSessionResult>> {
    const user = await this.repo.findByEmailWithPassword(input.email);

    // Same failure for an unknown email and a wrong password, deliberately:
    // distinguishing them turns the endpoint into an account-existence oracle.
    if (user === null) {
      // Hash anyway, so the response time does not reveal which case it was.
      await argon2.hash(input.password, { type: argon2.argon2id }).catch(() => undefined);
      return this.invalidCredentials();
    }

    if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
      const retryAfterSeconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      return fail(
        ERROR_CODES.ACCOUNT_LOCKED,
        MESSAGE_KEYS.auth.ACCOUNT_LOCKED,
        HTTP_STATUS.TOO_MANY_REQUESTS,
        { retryAfterSeconds, rejectionReason: 'failed_login_lockout' },
      );
    }

    const matches = await argon2.verify(user.passwordHash, input.password).catch(() => false);

    if (!matches) {
      const shouldLock = user.failedLoginCount + 1 >= MAX_FAILED_LOGINS;
      const lockUntil = shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
      const count = await this.repo.recordFailedLogin(user._id, lockUntil);
      logger.warn('failed login', { user_id: user._id, failed_count: count });
      return this.invalidCredentials();
    }

    const status = user.status;

    // A banned or deleted account is refused before a session is minted.
    if (!SESSION_ALLOWED_STATUSES.includes(status)) {
      return fail(
        status === USER_STATUSES.BANNED ? ERROR_CODES.ACCOUNT_BANNED : ERROR_CODES.ACCOUNT_DELETED,
        status === USER_STATUSES.BANNED
          ? MESSAGE_KEYS.access.ACCOUNT_BANNED
          : MESSAGE_KEYS.access.ACCOUNT_DELETED,
        HTTP_STATUS.FORBIDDEN,
        { rejectionReason: `login_blocked_status_${status}` },
      );
    }

    await this.repo.recordSuccessfulLogin(user._id);

    const issued = await this.issueSession(user._id, user.role, status, origin);
    const fresh = await this.repo.findById(user._id);

    return ok({ user: toUserView(fresh ?? user), tokens: issued.tokens });
  }

  /**
   * Rotates the refresh token: the presented one is revoked and a new pair is
   * issued, so a token is good exactly once.
   *
   * Reuse detection is the reason rotation is worth the complexity. A token
   * presented after it was already rotated means two parties hold it — the
   * legitimate client and a thief — and there is no way to tell which is
   * asking. Every session for the user is revoked, forcing a fresh sign-in.
   */
  async refresh(
    refreshToken: string,
    origin: SessionOrigin,
  ): Promise<ServiceResult<AuthSessionResult>> {
    const session = await this.repo.findSessionByHash(hashRefreshToken(refreshToken));

    if (session === null) {
      return fail(ERROR_CODES.TOKEN_INVALID, MESSAGE_KEYS.auth.TOKEN_INVALID, HTTP_STATUS.UNAUTHORIZED, {
        rejectionReason: 'refresh_token_unknown',
      });
    }

    if (session.revokedAt !== null) {
      // A session already killed BY a reuse incident keeps reporting the
      // incident. It is one of the sibling sessions revoked when theft was
      // detected, and its holder needs the same "sign in again, this was a
      // security action" signal as the session that triggered it.
      if (session.revokedReason === 'reuse_detected') {
        return fail(
          ERROR_CODES.SESSION_REVOKED,
          MESSAGE_KEYS.auth.SESSION_REVOKED,
          HTTP_STATUS.UNAUTHORIZED,
          { rejectionReason: 'refresh_token_reuse_detected' },
        );
      }

      // A token that was deliberately ended — a logout, a password change, a
      // ban — is simply dead. Treating that as theft would revoke the user's
      // other devices every time they sign out on one of them, and would fill
      // the alert channel with events that are not incidents.
      if (session.revokedReason !== null && session.revokedReason !== 'rotated') {
        return fail(
          ERROR_CODES.TOKEN_INVALID,
          MESSAGE_KEYS.auth.TOKEN_INVALID,
          HTTP_STATUS.UNAUTHORIZED,
          { rejectionReason: `refresh_token_${session.revokedReason}` },
        );
      }

      // A token that was ROTATED away and is now being presented again means
      // two parties hold it, and there is no way to tell which one is asking.
      // Every session goes.
      const revokedCount = await this.repo.revokeAllSessionsForUser(
        session.userId,
        'reuse_detected',
      );
      logger.error('refresh token reuse detected — all sessions revoked', {
        user_id: session.userId,
        session_id: session._id,
        revoked_count: revokedCount,
      });
      return fail(
        ERROR_CODES.SESSION_REVOKED,
        MESSAGE_KEYS.auth.SESSION_REVOKED,
        HTTP_STATUS.UNAUTHORIZED,
        { rejectionReason: 'refresh_token_reuse_detected' },
      );
    }

    // The TTL index sweeps expired sessions roughly once a minute, so expiry
    // is enforced here rather than trusted to have already been swept.
    if (session.expiresAt <= new Date()) {
      return fail(ERROR_CODES.TOKEN_EXPIRED, MESSAGE_KEYS.auth.TOKEN_EXPIRED, HTTP_STATUS.UNAUTHORIZED, {
        rejectionReason: 'refresh_token_expired',
      });
    }

    const user = await this.repo.findById(session.userId);
    if (user === null) {
      return fail(ERROR_CODES.TOKEN_INVALID, MESSAGE_KEYS.auth.TOKEN_INVALID, HTTP_STATUS.UNAUTHORIZED, {
        rejectionReason: 'session_user_missing',
      });
    }

    const status = user.status;

    // Refresh is where a mid-session ban takes effect: the access token's
    // claims are stale by design, and this is the point they get re-checked.
    if (!SESSION_ALLOWED_STATUSES.includes(status)) {
      await this.repo.revokeAllSessionsForUser(user._id, 'status_change');
      return fail(
        status === USER_STATUSES.BANNED ? ERROR_CODES.ACCOUNT_BANNED : ERROR_CODES.ACCOUNT_DELETED,
        status === USER_STATUSES.BANNED
          ? MESSAGE_KEYS.access.ACCOUNT_BANNED
          : MESSAGE_KEYS.access.ACCOUNT_DELETED,
        HTTP_STATUS.FORBIDDEN,
        { rejectionReason: `refresh_blocked_status_${status}` },
      );
    }

    const issued = await this.issueSession(user._id, user.role, status, origin);
    await this.repo.revokeSession(session._id, issued.sessionId, 'rotated');

    return ok({ user: toUserView(user), tokens: issued.tokens });
  }

  async logout(refreshToken: string): Promise<ServiceResult<null>> {
    const session = await this.repo.findSessionByHash(hashRefreshToken(refreshToken));

    // Logout is idempotent: an unknown or already-revoked token still means
    // "you are signed out". Reporting an error here only ever confuses a
    // client that is retrying.
    if (session !== null && session.revokedAt === null) {
      await this.repo.revokeSession(session._id, null, 'logout');
    }

    return ok(null);
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
  ): Promise<ServiceResult<null>> {
    const user = await this.repo.findByIdWithPassword(userId);
    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const matches = await argon2.verify(user.passwordHash, input.current_password).catch(() => false);
    if (!matches) {
      return fail(
        ERROR_CODES.INVALID_CREDENTIALS,
        MESSAGE_KEYS.auth.INVALID_CREDENTIALS,
        HTTP_STATUS.UNAUTHORIZED,
        {
          fieldErrors: { current_password: ['That is not your current password'] },
          rejectionReason: 'current_password_mismatch',
        },
      );
    }

    const passwordHash = await argon2.hash(input.new_password, { type: argon2.argon2id });
    await this.repo.setPasswordHash(userId, passwordHash);

    // A password change must invalidate sessions elsewhere — that is the whole
    // point of changing it after a suspected compromise.
    const revoked = await this.repo.revokeAllSessionsForUser(userId, 'password_change');
    logger.info('password changed, sessions revoked', { user_id: userId, revoked_count: revoked });

    emailService.dispatch({
      kind: EMAIL_KINDS.PASSWORD_CHANGED,
      to: user.email,
      ownerId: user._id,
      content: passwordChangedEmail(user.name),
    });

    return ok(null);
  }

  /**
   * Asking for a reset link.
   *
   * ALWAYS succeeds, whatever the email. Telling somebody "no account with
   * that address" turns this endpoint into a way to discover who has an
   * account, and that is worth more to an attacker than the reset is to them.
   */
  async requestPasswordReset(email: string, ip: string | null): Promise<ServiceResult<null>> {
    const user = await this.repo.findByEmail(email);

    if (user === null) {
      logger.info('password reset asked for an address we do not have', { email });
      return ok(null);
    }

    // Any earlier link is spent the moment a new one is asked for, so a
    // forwarded old email cannot be used after a fresh request.
    await PasswordResetModel.updateMany(
      { userId: user._id, usedAt: null },
      { $set: { usedAt: new Date() } },
    ).exec();

    const token = randomBytes(48).toString('base64url');

    await PasswordResetModel.create({
      userId: user._id,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
      requestedIp: ip,
    });

    emailService.dispatch({
      kind: EMAIL_KINDS.PASSWORD_RESET,
      to: user.email,
      ownerId: user._id,
      content: passwordResetEmail(user.name, token),
    });

    logger.info('password reset link issued', { user_id: user._id });
    return ok(null);
  }

  /**
   * Spending a reset link.
   *
   * The token is looked up by HASH — the plain one is only ever in the email —
   * and every session is revoked, because whoever asked for this may well be
   * locking somebody else out.
   */
  async resetPassword(token: string, newPassword: string): Promise<ServiceResult<null>> {
    const record = await PasswordResetModel.findOne({
      tokenHash: hashRefreshToken(token),
    }).exec();

    // One error for expired, spent and never-existed alike: the difference is
    // not useful to the person and is useful to somebody guessing.
    const invalid =
      record === null || record.usedAt !== null || record.expiresAt.getTime() < Date.now();

    if (invalid) {
      logger.warn('password reset attempted with a bad token', {
        found: record !== null,
        used: record?.usedAt !== null && record?.usedAt !== undefined,
      });
      return fail(
        ERROR_CODES.TOKEN_INVALID,
        MESSAGE_KEYS.auth.TOKEN_INVALID,
        HTTP_STATUS.BAD_REQUEST,
        { rejectionReason: 'reset_token_invalid' },
      );
    }

    const user = await this.repo.findByIdWithPassword(record.userId);
    if (user === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.users.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // Spent BEFORE the password is set: if anything below fails, the link is
    // still burnt, which is the safe direction to fail in.
    record.usedAt = new Date();
    await record.save();

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.repo.setPasswordHash(user._id, passwordHash);

    const revoked = await this.repo.revokeAllSessionsForUser(user._id, 'password_change');
    logger.info('password reset, sessions revoked', { user_id: user._id, revoked_count: revoked });

    emailService.dispatch({
      kind: EMAIL_KINDS.PASSWORD_CHANGED,
      to: user.email,
      ownerId: user._id,
      content: passwordChangedEmail(user.name),
    });

    return ok(null);
  }

  private invalidCredentials(): ServiceResult<never> {
    return fail(
      ERROR_CODES.INVALID_CREDENTIALS,
      MESSAGE_KEYS.auth.INVALID_CREDENTIALS,
      HTTP_STATUS.UNAUTHORIZED,
      { rejectionReason: 'email_or_password_mismatch' },
    );
  }

  private async issueSession(
    userId: string,
    role: UserRole,
    status: UserStatus,
    origin: SessionOrigin,
  ): Promise<IssuedSession> {
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + refreshTokenTtlSeconds() * 1000);

    const session = await this.repo.createSession({
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      userAgent: origin.userAgent,
      ip: origin.ip,
    });

    const accessToken = signAccessToken({ sub: userId, role, status, sid: session._id });

    const tokens: AuthTokens = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: accessTokenTtlSeconds(),
    };

    return { sessionId: session._id, tokens };
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: number }).code === 11000
  );
}

export const authService = AuthService.getInstance();
