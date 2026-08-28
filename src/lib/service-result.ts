import type { ErrorCode } from '@shared/constants/error-codes.js';
import type { MessageKey } from '@shared/messages/keys.js';

import { AppError } from './errors.js';

/**
 * Services return this. They never throw for an expected domain failure —
 * "email taken", "wrong password", "not found" are ordinary outcomes, and
 * making them exceptions hides them from the type system.
 *
 * Throwing is reserved for the genuinely unexpected: the database is down,
 * or there is a bug.
 */
export type ServiceResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      code: ErrorCode;
      messageKey: MessageKey;
      httpStatus: number;
      fieldErrors?: Record<string, string[]>;
      rejectionReason?: string;
      retryAfterSeconds?: number;
      /** Replaces the registry message when the service knows something specific. */
      overrideMessage?: string;
    };

export type ServiceFailure = Extract<ServiceResult<never>, { success: false }>;

export const ok = <T>(data: T): ServiceResult<T> => ({ success: true, data });

export const fail = (
  code: ErrorCode,
  messageKey: MessageKey,
  httpStatus: number,
  extra: {
    fieldErrors?: Record<string, string[]>;
    rejectionReason?: string;
    retryAfterSeconds?: number;
    overrideMessage?: string;
  } = {},
): ServiceFailure => ({
  success: false,
  code,
  messageKey,
  httpStatus,
  // Conditional spread, not `key: undefined` — exactOptionalPropertyTypes
  // treats an absent key and an undefined one as different things.
  ...(extra.fieldErrors !== undefined && { fieldErrors: extra.fieldErrors }),
  ...(extra.rejectionReason !== undefined && { rejectionReason: extra.rejectionReason }),
  ...(extra.retryAfterSeconds !== undefined && { retryAfterSeconds: extra.retryAfterSeconds }),
  ...(extra.overrideMessage !== undefined && { overrideMessage: extra.overrideMessage }),
});

/**
 * Converts a failed ServiceResult into the throw the error middleware renders.
 *
 * This is not in tension with "services never throw". The *service* returns a
 * value, so its branching stays testable without try/catch. The *controller*
 * converts that value into a throw at the HTTP boundary, so one middleware owns
 * every error rendering. Without it, each controller builds its own envelope
 * and they drift.
 */
export const bail = (failure: ServiceFailure): never => {
  throw new AppError(
    failure.code,
    failure.httpStatus,
    `service rejected: ${failure.code}`,
    failure.messageKey,
    failure.fieldErrors,
    failure.rejectionReason,
    failure.retryAfterSeconds,
    failure.overrideMessage,
  );
};
