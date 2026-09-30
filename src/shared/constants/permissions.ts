/**
 * Scopes: the per-resource, per-action permission grain.
 *
 * Roles answer "what kind of account is this?" and keep guarding the console
 * door. Scopes answer "may this staff member do this specific thing?" — which
 * a rank comparison cannot express, because "may edit recipes, may not touch
 * customers" is not a point on a ladder.
 *
 * Both halves come from closed lists and the pair is a template literal type,
 * so a typo is a compile error rather than a silently ungranted permission.
 */

export const RESOURCES = [
  'recipes',
  'images',
  'users',
  'staff',
  'emails',
  'ai',
  'jobs',
  'flags',
  'decide',
  'chowdeck',
  'settings',
  'scripts',
  'audit',
] as const;

export type Resource = (typeof RESOURCES)[number];

/**
 * Three actions, not four.
 *
 * `update` is folded into `write`: of the 36 mutating admin routes, not one is
 * a create that somebody should be able to do while being unable to edit — or
 * the reverse. Two scopes always granted together is a checkbox that teaches
 * operators the checkboxes do not matter.
 *
 * `delete` IS separate, because it destroys work and is the grant you withhold
 * from a new hire.
 */
export const ACTIONS = ['read', 'write', 'delete'] as const;

export type Action = (typeof ACTIONS)[number];

export type Scope = `${Resource}:${Action}`;

/** Every legal scope. The allowlist a granted value is validated against. */
export const ALL_SCOPES: readonly Scope[] = RESOURCES.flatMap((resource) =>
  ACTIONS.map((action): Scope => `${resource}:${action}`),
);

const SCOPE_SET = new Set<string>(ALL_SCOPES);

export const isScope = (value: string): value is Scope => SCOPE_SET.has(value);

/**
 * Whether a held set satisfies a required scope.
 *
 * Implication is expressed HERE, once, rather than by granting three scopes
 * where one was meant: `write` implies `read`, and `delete` implies `write`
 * (and therefore `read`). Granting write without read would describe somebody
 * who may change a recipe they cannot open, which is not a real permission set
 * — so no operator is able to build one.
 */
export function satisfies(held: readonly string[], needed: Scope): boolean {
  if (held.includes(needed)) return true;

  const separator = needed.indexOf(':');
  const resource = needed.slice(0, separator);
  const action = needed.slice(separator + 1);

  if (action === 'read') {
    return held.includes(`${resource}:write`) || held.includes(`${resource}:delete`);
  }
  if (action === 'write') {
    return held.includes(`${resource}:delete`);
  }
  // `delete` is the top of the chain — nothing implies it.
  return false;
}

/**
 * The scopes a set actually confers, implications resolved.
 *
 * For the console: an operator granting `recipes:delete` must SEE that they
 * also granted read and write, rather than discovering it later.
 */
export function expand(held: readonly string[]): Scope[] {
  return ALL_SCOPES.filter((scope) => satisfies(held, scope));
}

/** Drops anything not a real scope. Applied to any value arriving from a client. */
export function sanitise(values: readonly string[]): Scope[] {
  return values.filter(isScope);
}
