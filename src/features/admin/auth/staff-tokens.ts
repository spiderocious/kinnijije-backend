import jwt from 'jsonwebtoken';

import { env } from '@app/env.js';
import type { StaffStatus, StaffTier } from '../staff/staff-user.model.js';

/**
 * Console tokens, on their own audience.
 *
 * THIS IS THE SEPARATION GUARANTEE. `jwt.verify` is given
 * `audience: 'cookiepot-console'`, so a customer token does not merely fail a
 * role check — it fails verification outright and can never reach an admin
 * route, whatever claims somebody puts in it.
 *
 * That is strictly stronger than the previous design, where one token type
 * served both surfaces and a `role` claim was the only thing between a
 * customer and the console.
 *
 * The tier and status ride in the claims so an ordinary console request needs
 * no lookup, exactly as the customer token does. PERMISSIONS DO NOT: a revoked
 * scope that kept working until the token expired is a person still deleting
 * things after you stopped them, so `requireScope` reads those per request.
 */

const ISSUER = 'cookiepot';
const AUDIENCE = 'cookiepot-console';

export interface StaffTokenClaims {
  sub: string;
  tier: StaffTier;
  status: StaffStatus;
  /** Session id, so a single console session can be revoked. */
  sid: string;
}

export const staffAccessTtlSeconds = (): number => env.ACCESS_TOKEN_TTL_MINUTES * 60;

export const signStaffToken = (claims: StaffTokenClaims): string =>
  jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: staffAccessTtlSeconds(),
    issuer: ISSUER,
    audience: AUDIENCE,
  });

export type StaffVerifyResult =
  | { valid: true; claims: StaffTokenClaims }
  | { valid: false; reason: 'expired' | 'invalid' };

export function verifyStaffToken(token: string): StaffVerifyResult {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      // A customer token carries `cookiepot-web` and is rejected HERE, before
      // any claim is read.
      audience: AUDIENCE,
    });

    if (typeof decoded === 'string') return { valid: false, reason: 'invalid' };

    const { sub, tier, status, sid } = decoded as Partial<StaffTokenClaims>;
    if (
      typeof sub !== 'string' ||
      typeof tier !== 'string' ||
      typeof status !== 'string' ||
      typeof sid !== 'string'
    ) {
      return { valid: false, reason: 'invalid' };
    }

    return { valid: true, claims: { sub, tier, status, sid } };
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    return { valid: false, reason: expired ? 'expired' : 'invalid' };
  }
}
