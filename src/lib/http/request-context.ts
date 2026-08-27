import { AsyncLocalStorage } from 'node:async_hooks';

import type { UserRole, UserStatus } from '@shared/constants/roles.js';

export interface RequestContext {
  request_id: string;
  method: string;
  path: string;
  user_id?: string;
  role?: UserRole;
  status?: UserStatus;
  session_id?: string;
}

/**
 * Carries per-request identity through the call stack so services never see
 * `req`. Passing the request object into a service couples business logic to
 * Express and makes it untestable without a fake request.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export const getContext = (): RequestContext | undefined => requestContext.getStore();

/** The request id, or a placeholder outside a request (a boot log, a script). */
export const currentRequestId = (): string => requestContext.getStore()?.request_id ?? '-';
