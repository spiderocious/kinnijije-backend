import { ERROR_CODES, type ErrorCode } from '@shared/constants/error-codes.js';

import { MESSAGE_KEYS, type MessageKey } from './keys.js';

const CATALOG: Record<MessageKey, string> = {
  [MESSAGE_KEYS.auth.REGISTERED]: 'Account created. Welcome to Cookiepot.',
  [MESSAGE_KEYS.auth.LOGIN_SUCCESS]: 'Signed in successfully.',
  [MESSAGE_KEYS.auth.LOGGED_OUT]: 'Signed out successfully.',
  [MESSAGE_KEYS.auth.TOKEN_REFRESHED]: 'Session refreshed.',
  [MESSAGE_KEYS.auth.INVALID_CREDENTIALS]: 'That email or password is not right.',
  [MESSAGE_KEYS.auth.EMAIL_EXISTS]: 'An account with that email already exists.',
  [MESSAGE_KEYS.auth.TOKEN_INVALID]: 'That session token is not valid. Please sign in again.',
  [MESSAGE_KEYS.auth.TOKEN_EXPIRED]: 'Your session has expired. Please sign in again.',
  [MESSAGE_KEYS.auth.SESSION_REVOKED]:
    'This session was ended for your security. Please sign in again.',
  [MESSAGE_KEYS.auth.UNAUTHENTICATED]: 'You need to be signed in to do that.',
  [MESSAGE_KEYS.auth.ACCOUNT_LOCKED]:
    'Too many failed sign-in attempts. Try again in a few minutes.',
  [MESSAGE_KEYS.auth.PASSWORD_CHANGED]: 'Your password has been changed.',

  [MESSAGE_KEYS.users.PROFILE_FETCHED]: 'Profile loaded.',
  [MESSAGE_KEYS.users.PROFILE_UPDATED]: 'Profile updated.',
  [MESSAGE_KEYS.users.LIST_FETCHED]: 'Users loaded.',
  [MESSAGE_KEYS.users.STATUS_UPDATED]: 'Account status updated.',
  [MESSAGE_KEYS.users.ROLE_UPDATED]: 'Account role updated.',
  [MESSAGE_KEYS.users.NOT_FOUND]: 'That user does not exist.',
  [MESSAGE_KEYS.users.CANNOT_DEMOTE_SELF]: 'You cannot change your own role.',

  [MESSAGE_KEYS.access.FORBIDDEN]: 'You do not have permission to do that.',
  [MESSAGE_KEYS.access.INSUFFICIENT_ROLE]: 'Your account role does not allow that action.',
  [MESSAGE_KEYS.access.ACCOUNT_SUSPENDED]:
    'Your account is suspended, so that action is unavailable.',
  [MESSAGE_KEYS.access.ACCOUNT_BANNED]: 'Your account has been banned.',
  [MESSAGE_KEYS.access.ACCOUNT_DELETED]: 'This account has been deleted.',
  [MESSAGE_KEYS.access.ACCOUNT_PENDING_VERIFICATION]:
    'Please verify your email before doing that.',

  [MESSAGE_KEYS.files.UPLOAD_READY]: 'Ready to upload.',
  [MESSAGE_KEYS.files.UPLOAD_CONFIRMED]: 'Upload received.',
  [MESSAGE_KEYS.files.LIST_FETCHED]: 'Files loaded.',
  [MESSAGE_KEYS.files.NOT_FOUND]: 'That file does not exist.',
  [MESSAGE_KEYS.files.NOT_UPLOADED]:
    'That file has not finished uploading yet. Upload it, then confirm again.',
  [MESSAGE_KEYS.files.STORAGE_UNAVAILABLE]:
    'File storage is not available right now. Please try again shortly.',

  [MESSAGE_KEYS.stock.FETCHED]: 'Kitchen loaded.',
  [MESSAGE_KEYS.stock.ADDED]: 'Added to your kitchen.',
  [MESSAGE_KEYS.stock.UPDATED]: 'Updated.',
  [MESSAGE_KEYS.stock.REMOVED]: 'Removed from your kitchen.',
  [MESSAGE_KEYS.stock.NOT_FOUND]: 'That is not in your kitchen.',
  [MESSAGE_KEYS.stock.UNIT_EXISTS]: 'You already have a unit with that name.',

  [MESSAGE_KEYS.market.FETCHED]: 'Market list loaded.',
  [MESSAGE_KEYS.market.ADDED]: 'Added to your list.',
  [MESSAGE_KEYS.market.REMOVED]: 'Taken off your list.',
  [MESSAGE_KEYS.market.BOUGHT]: 'Moved into your kitchen.',
  [MESSAGE_KEYS.market.NOT_FOUND]: 'That is not on your list.',
  [MESSAGE_KEYS.market.ALREADY_BOUGHT]: 'You already ticked that one off.',

  [MESSAGE_KEYS.meals.FETCHED]: 'Meals loaded.',
  [MESSAGE_KEYS.meals.NOT_FOUND]: 'That meal does not exist.',
  [MESSAGE_KEYS.meals.FAVOURITED]: 'Saved.',
  [MESSAGE_KEYS.meals.COOKED]: 'Enjoy it.',

  [MESSAGE_KEYS.chat.ANSWERED]: 'Answered.',
  [MESSAGE_KEYS.chat.FAILED]: 'I could not answer that one. Try asking another way.',

  [MESSAGE_KEYS.jobs.FETCHED]: 'Jobs loaded.',
  [MESSAGE_KEYS.jobs.NOT_FOUND]: 'That job does not exist.',
  [MESSAGE_KEYS.jobs.NOT_CANCELLABLE]: 'That job has already finished, so there is nothing to cancel.',
  [MESSAGE_KEYS.jobs.NOT_RETRYABLE]: 'Only work that failed or was cancelled can be retried.',
  [MESSAGE_KEYS.jobs.CANCELLED]: 'Stopping that.',
  [MESSAGE_KEYS.jobs.RETRIED]: 'Trying that again.',

  [MESSAGE_KEYS.kitchen.FETCHED]: 'Kitchen loaded.',
  [MESSAGE_KEYS.kitchen.SAVED]: 'Kitchen saved.',

  [MESSAGE_KEYS.onboarding.FETCHED]: 'Onboarding loaded.',
  [MESSAGE_KEYS.onboarding.SAVED]: 'Saved.',
  [MESSAGE_KEYS.onboarding.COMPLETED]: 'You are all set.',
  [MESSAGE_KEYS.onboarding.ALREADY_COMPLETED]: 'You have already finished setting up.',

  [MESSAGE_KEYS.common.VALIDATION_ERROR]: 'Some of the details you sent are not valid.',
  [MESSAGE_KEYS.common.MALFORMED_JSON]: 'The request body is not valid JSON.',
  [MESSAGE_KEYS.common.RATE_LIMITED]: 'Too many requests. Please slow down.',
  [MESSAGE_KEYS.common.NOT_FOUND]: 'That resource does not exist.',
  [MESSAGE_KEYS.common.INTERNAL]: 'Something went wrong on our side. Please try again.',
  [MESSAGE_KEYS.common.UPSTREAM_FAILURE]: 'A service we depend on is unavailable right now.',
  [MESSAGE_KEYS.common.HEALTHY]: 'Service is healthy.',
};

/**
 * Fallback message per error identity. Used when an error reaches the handler
 * without an explicit key — every error still resolves real, human text.
 * A generic "Request failed" default is a bug, not a fallback.
 */
const FALLBACK_BY_CODE: Record<ErrorCode, MessageKey> = {
  [ERROR_CODES.INVALID_CREDENTIALS]: MESSAGE_KEYS.auth.INVALID_CREDENTIALS,
  [ERROR_CODES.EMAIL_EXISTS]: MESSAGE_KEYS.auth.EMAIL_EXISTS,
  [ERROR_CODES.TOKEN_INVALID]: MESSAGE_KEYS.auth.TOKEN_INVALID,
  [ERROR_CODES.TOKEN_EXPIRED]: MESSAGE_KEYS.auth.TOKEN_EXPIRED,
  [ERROR_CODES.SESSION_REVOKED]: MESSAGE_KEYS.auth.SESSION_REVOKED,
  [ERROR_CODES.UNAUTHENTICATED]: MESSAGE_KEYS.auth.UNAUTHENTICATED,
  [ERROR_CODES.ACCOUNT_LOCKED]: MESSAGE_KEYS.auth.ACCOUNT_LOCKED,

  [ERROR_CODES.FORBIDDEN]: MESSAGE_KEYS.access.FORBIDDEN,
  [ERROR_CODES.INSUFFICIENT_ROLE]: MESSAGE_KEYS.access.INSUFFICIENT_ROLE,
  [ERROR_CODES.ACCOUNT_SUSPENDED]: MESSAGE_KEYS.access.ACCOUNT_SUSPENDED,
  [ERROR_CODES.ACCOUNT_BANNED]: MESSAGE_KEYS.access.ACCOUNT_BANNED,
  [ERROR_CODES.ACCOUNT_DELETED]: MESSAGE_KEYS.access.ACCOUNT_DELETED,
  [ERROR_CODES.ACCOUNT_PENDING_VERIFICATION]: MESSAGE_KEYS.access.ACCOUNT_PENDING_VERIFICATION,

  [ERROR_CODES.FILE_NOT_UPLOADED]: MESSAGE_KEYS.files.NOT_UPLOADED,
  [ERROR_CODES.STORAGE_UNAVAILABLE]: MESSAGE_KEYS.files.STORAGE_UNAVAILABLE,
  [ERROR_CODES.ONBOARDING_ALREADY_COMPLETED]: MESSAGE_KEYS.onboarding.ALREADY_COMPLETED,

  [ERROR_CODES.JOB_NOT_CANCELLABLE]: MESSAGE_KEYS.jobs.NOT_CANCELLABLE,
  [ERROR_CODES.JOB_NOT_RETRYABLE]: MESSAGE_KEYS.jobs.NOT_RETRYABLE,

  [ERROR_CODES.NOT_FOUND]: MESSAGE_KEYS.common.NOT_FOUND,
  [ERROR_CODES.ALREADY_EXISTS]: MESSAGE_KEYS.common.VALIDATION_ERROR,

  [ERROR_CODES.VALIDATION_ERROR]: MESSAGE_KEYS.common.VALIDATION_ERROR,
  [ERROR_CODES.MALFORMED_JSON]: MESSAGE_KEYS.common.MALFORMED_JSON,
  [ERROR_CODES.RATE_LIMITED]: MESSAGE_KEYS.common.RATE_LIMITED,

  [ERROR_CODES.INTERNAL]: MESSAGE_KEYS.common.INTERNAL,
  [ERROR_CODES.UPSTREAM_FAILURE]: MESSAGE_KEYS.common.UPSTREAM_FAILURE,
};

export const messages = {
  get: (key: MessageKey): string => CATALOG[key],
};

export const resolveErrorMessage = (code: ErrorCode, key?: MessageKey): string =>
  CATALOG[key ?? FALLBACK_BY_CODE[code]];

export { MESSAGE_KEYS, type MessageKey };
