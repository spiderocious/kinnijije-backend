import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { USER_ROLES, roleAtLeast } from '@shared/constants/roles.js';

/**
 * The rule that closes the escalation hole.
 *
 * `PATCH /admin/users/:userId/role` used to be a bare `updateOne` with the
 * schema accepting `super_admin`, so any admin could promote themselves and
 * their existing token kept working. The guard is expressed as
 * "`roleAtLeast(granted, actor)` must be false" — which is subtle enough that
 * it is worth pinning the truth table rather than trusting a reading of it.
 */
describe('role-grant ceiling', () => {
  const mayGrant = (actingRole: typeof USER_ROLES[keyof typeof USER_ROLES], granted: typeof USER_ROLES[keyof typeof USER_ROLES]): boolean =>
    actingRole === USER_ROLES.SUPER_ADMIN || !roleAtLeast(granted, actingRole);

  it('refuses an admin granting admin — the self-promotion path', () => {
    assert.equal(mayGrant(USER_ROLES.ADMIN, USER_ROLES.ADMIN), false);
  });

  it('refuses an admin granting super_admin — THE hole', () => {
    assert.equal(mayGrant(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), false);
  });

  it('allows an admin granting the tiers below it', () => {
    assert.equal(mayGrant(USER_ROLES.ADMIN, USER_ROLES.MODERATOR), true);
    assert.equal(mayGrant(USER_ROLES.ADMIN, USER_ROLES.USER), true);
  });

  it('lets a super admin grant anything, including a peer', () => {
    assert.equal(mayGrant(USER_ROLES.SUPER_ADMIN, USER_ROLES.SUPER_ADMIN), true);
    assert.equal(mayGrant(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN), true);
  });

  it('refuses a moderator granting anything at or above itself', () => {
    assert.equal(mayGrant(USER_ROLES.MODERATOR, USER_ROLES.MODERATOR), false);
    assert.equal(mayGrant(USER_ROLES.MODERATOR, USER_ROLES.ADMIN), false);
    assert.equal(mayGrant(USER_ROLES.MODERATOR, USER_ROLES.USER), true);
  });
});
