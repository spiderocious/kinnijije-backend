import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { isScope } from '@shared/constants/permissions.js';

/**
 * Every admin route must carry exactly one scope.
 *
 * This reads the route FILES as text rather than exercising the router, and
 * that is deliberate: the failure being guarded against is somebody adding a
 * route and forgetting the gate, which a runtime test of existing routes
 * cannot see. A missed route is an unguarded hole; a wrong scope is a lockout.
 *
 * BOTH files are checked. `/admin` is defined in two places — the console's own
 * routes and the Chowdeck partner surface — and a design that only covered the
 * first would leave ten mutating partner routes ungated, including a purge.
 */
const ROUTE_FILES = [
  'src/features/admin/admin.routes.ts',
  'src/features/chowdeck/chowdeck.routes.ts',
];

/**
 * The routes that legitimately have no scope. Each one needs a reason.
 *
 *  - the two setup routes: unauthenticated by necessity — you cannot log in to
 *    create the first login
 *  - the dashboard: the console's landing page, so gating it would land every
 *    scoped staff member on a 403 instead of a screen
 *  - the two invite routes: the invitee has no password yet, so there is
 *    nothing to authenticate with. Both are rate-limited with REGISTER and
 *    guarded by the token itself.
 */
const EXEMPT = new Set([
  '/admin/setup',
  '/admin/overview',
  '/admin/invites/:token',
  '/admin/invites/:token/accept',
]);

interface RouteDecl {
  readonly file: string;
  readonly path: string;
  readonly block: string;
}

/**
 * Comments stripped before any position comparison.
 *
 * Without this, a comment that merely MENTIONS `requireScope` above the
 * middleware list reads as a call site and the ordering assertion fails on
 * correct code — which is exactly what happened while writing this.
 */
function code(block: string): string {
  return block.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function routesIn(file: string): RouteDecl[] {
  const source = readFileSync(file, 'utf8');
  const out: RouteDecl[] = [];

  /**
   * Split on the `router.` boundary rather than regex-matching whole calls.
   *
   * A pattern with a lazy `.*?\n\);` looks right and silently swallows several
   * routes at once when they are formatted across lines — it parsed 30 of 69
   * and the suite passed vacuously. Slicing between boundaries cannot do that.
   */
  const parts = source.split(/(?=router\.(?:get|post|patch|put|delete)\()/);
  for (const part of parts.slice(1)) {
    const end = part.indexOf('\n);');
    const block = end === -1 ? part.split('\n')[0] ?? part : part.slice(0, end + 3);
    const path = /'(\/admin[^']*)'/.exec(block)?.[1];
    if (path === undefined) continue;
    out.push({ file, path, block });
  }
  return out;
}

const ALL = ROUTE_FILES.flatMap(routesIn);

describe('admin scope coverage', () => {
  it('finds routes in both route files', () => {
    for (const file of ROUTE_FILES) {
      assert.ok(routesIn(file).length > 0, `no /admin routes parsed from ${file}`);
    }
    // Guards against the regex silently breaking and the suite passing vacuously.
    assert.ok(ALL.length >= 60, `expected ~69 admin routes, parsed ${String(ALL.length)}`);
  });

  it('gates every route that is not deliberately exempt', () => {
    const unguarded = ALL.filter(
      (route) => !EXEMPT.has(route.path) && !route.block.includes('requireScope'),
    ).map((route) => `${route.file} ${route.path}`);

    assert.deepEqual(unguarded, [], 'these admin routes have no requireScope');
  });

  it('uses only real scopes', () => {
    for (const route of ALL) {
      const found = /requireScope\('([^']+)'\)/.exec(route.block)?.[1];
      if (found === undefined) continue;
      assert.equal(isScope(found), true, `${route.path} requires a bogus scope: ${found}`);
    }
  });

  it('puts requireScope AFTER the auth guard, never before', () => {
    // requireScope calls requireActor, which throws unless `authenticate` has
    // already run. Ordering here is load-bearing, not style.
    for (const route of ALL) {
      const body = code(route.block);
      if (!body.includes('requireScope')) continue;
      const scopeAt = body.indexOf('requireScope');
      const guardAt = Math.max(
        body.indexOf('...guard'),
        body.indexOf('...read'),
        body.indexOf('...action'),
        body.indexOf('authenticate'),
      );
      assert.ok(
        guardAt !== -1 && guardAt < scopeAt,
        `${route.path}: requireScope runs before authentication`,
      );
    }
  });

  it('never gates a read route with a write scope', () => {
    for (const route of ALL) {
      const isGet = route.block.startsWith('router.get');
      const scope = /requireScope\('([^']+)'\)/.exec(route.block)?.[1];
      if (!isGet || scope === undefined) continue;
      assert.ok(
        scope.endsWith(':read'),
        `${route.path} is a GET but demands ${scope} — that is a lockout, not a gate`,
      );
    }
  });
});
