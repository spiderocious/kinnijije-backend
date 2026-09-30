import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ALL_SCOPES, expand, isScope, sanitise, satisfies, type Scope } from '../permissions.js';
import { OWNER_ONLY_SCOPES, SEEDED_GROUPS } from '../permission-groups.js';

/**
 * This file IS the security boundary, so the truth table is pinned rather than
 * trusted to a reading of the implementation.
 */
describe('scope implication', () => {
  it('write implies read', () => {
    assert.equal(satisfies(['recipes:write'], 'recipes:read'), true);
  });

  it('delete implies write AND read', () => {
    assert.equal(satisfies(['recipes:delete'], 'recipes:write'), true);
    assert.equal(satisfies(['recipes:delete'], 'recipes:read'), true);
  });

  it('read does NOT imply write — the direction that matters', () => {
    assert.equal(satisfies(['recipes:read'], 'recipes:write'), false);
    assert.equal(satisfies(['recipes:read'], 'recipes:delete'), false);
  });

  it('write does not imply delete', () => {
    assert.equal(satisfies(['recipes:write'], 'recipes:delete'), false);
  });

  it('never leaks across resources', () => {
    // The bug that would be catastrophic and silent: holding one resource's
    // delete must say nothing about any other resource.
    assert.equal(satisfies(['recipes:delete'], 'users:read'), false);
    assert.equal(satisfies(['users:write'], 'recipes:read'), false);
    assert.equal(satisfies(['staff:write'], 'settings:write'), false);
  });

  it('an empty set satisfies nothing', () => {
    for (const scope of ALL_SCOPES) {
      assert.equal(satisfies([], scope), false, `empty set satisfied ${scope}`);
    }
  });
});

describe('scope validation', () => {
  it('accepts every generated scope', () => {
    for (const scope of ALL_SCOPES) assert.equal(isScope(scope), true, scope);
  });

  it('rejects invented resources, actions and shapes', () => {
    for (const bad of ['recipes:admin', 'everything:write', 'recipes', 'recipes:*', '', ':read']) {
      assert.equal(isScope(bad), false, `accepted ${bad}`);
    }
  });

  it('sanitise drops junk rather than throwing', () => {
    assert.deepEqual(sanitise(['recipes:write', 'nope:write', 'users:read']), [
      'recipes:write',
      'users:read',
    ]);
  });
});

describe('expand', () => {
  it('shows an operator what a grant really confers', () => {
    assert.deepEqual(expand(['recipes:delete']).sort(), [
      'recipes:delete',
      'recipes:read',
      'recipes:write',
    ]);
  });
});

describe('seeded groups', () => {
  it('only reference real scopes', () => {
    for (const group of SEEDED_GROUPS) {
      for (const scope of group.scopes) {
        assert.equal(isScope(scope), true, `${group.key} holds a bogus scope: ${scope}`);
      }
    }
  });

  it('keeps the escalation scopes out of every seeded group', () => {
    for (const group of SEEDED_GROUPS) {
      const effective = expand(group.scopes);
      for (const owned of OWNER_ONLY_SCOPES) {
        assert.equal(
          effective.includes(owned),
          false,
          `${group.key} confers the owner-only scope ${owned}`,
        );
      }
    }
  });

  it('gives Analyst nothing that writes', () => {
    const analyst = SEEDED_GROUPS.find((g) => g.key === 'analyst');
    assert.ok(analyst !== undefined);
    const writes = expand(analyst.scopes).filter(
      (s: Scope) => s.endsWith(':write') || s.endsWith(':delete'),
    );
    assert.deepEqual(writes, [], 'Analyst is supposed to be read-only');
  });
});
