import type { Request } from 'express';

/**
 * The matched route PATTERN — `/stock/:stockId`, never `/stock/stk_01H…`.
 *
 * Analytics and logs want the pattern: it has bounded cardinality and groups
 * correctly in a report, while the resolved path creates a distinct value per
 * id and makes a breakdown useless.
 *
 * `req.route` is typed `any` by Express's own definitions, so the narrowing is
 * done here once rather than with a suppression at each call site.
 */
export function routePattern(req: Request): string {
  const route: unknown = req.route;

  if (route !== null && typeof route === 'object' && 'path' in route) {
    const path: unknown = route.path;
    if (typeof path === 'string') return path;
  }

  // No matched route: a 404, or middleware that ran before routing.
  return req.baseUrl !== '' ? req.baseUrl : 'unmatched';
}
