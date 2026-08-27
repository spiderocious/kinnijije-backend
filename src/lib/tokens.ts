import { createHash, randomBytes } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '@app/env.js';
import type { UserRole, UserStatus } from '@shared/constants/roles.js';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  status: UserStatus;
  sid: string;
}

const ISSUER = 'cookiepot';
const AUDIENCE = 'cookiepot-web';

export const accessTokenTtlSeconds = (): number => env.ACCESS_TOKEN_TTL_MINUTES * 60;
export const refreshTokenTtlSeconds = (): number => env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

/**
 * The access token carries role and status as claims so an ordinary request
 * needs no user lookup. The trade-off is staleness: a role or status changed
 * mid-token is not seen until the token expires.
 *
 * That is why the TTL is short (15 min default) and why anything that must act
 * immediately — a ban — also revokes the sessions, which the refresh path
 * checks against the database.
 */
export const signAccessToken = (claims: AccessTokenClaims): string =>
  jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: accessTokenTtlSeconds(),
    issuer: ISSUER,
    audience: AUDIENCE,
  });

export type VerifyResult =
  | { valid: true; claims: AccessTokenClaims }
  | { valid: false; reason: 'expired' | 'invalid' };

export function verifyAccessToken(token: string): VerifyResult {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (typeof decoded === 'string') return { valid: false, reason: 'invalid' };

    const { sub, role, status, sid } = decoded as Partial<AccessTokenClaims>;
    if (
      typeof sub !== 'string' ||
      typeof role !== 'string' ||
      typeof status !== 'string' ||
      typeof sid !== 'string'
    ) {
      return { valid: false, reason: 'invalid' };
    }

    return { valid: true, claims: { sub, role, status, sid } };
  } catch (error) {
    // Expiry is an ordinary outcome the client resolves by refreshing; every
    // other failure is a bad token. The client needs to tell them apart.
    if (error instanceof jwt.TokenExpiredError) return { valid: false, reason: 'expired' };
    return { valid: false, reason: 'invalid' };
  }
}

/**
 * The refresh token is opaque random bytes, not a JWT. Nothing is encoded in
 * it: its only job is to be looked up, and an unguessable string does that
 * without the parsing surface a JWT brings.
 */
export const generateRefreshToken = (): string => randomBytes(48).toString('base64url');

/**
 * SHA-256 rather than argon2 here, deliberately. Argon2's slowness defends a
 * low-entropy human password against offline guessing; a 48-byte random token
 * has nothing to guess. A fast hash keeps the refresh path quick while still
 * meaning a stolen database yields no usable tokens.
 */
export const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
