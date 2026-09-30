import type { Scope } from './permissions.js';

/**
 * Named bundles of scopes. What an operator actually picks.
 *
 * Nobody should be assigning eighteen checkboxes per hire — that is how people
 * end up granting everything to make the screen go away.
 *
 * Seeded groups are `isSystem` and cannot be deleted, only copied and edited,
 * so a deployment always has something sane to grant.
 */
export interface GroupDefinition {
  readonly key: string;
  readonly name: string;
  /** What this group is FOR. An operator needs to know before granting it. */
  readonly description: string;
  readonly scopes: readonly Scope[];
}

export const SEEDED_GROUPS: readonly GroupDefinition[] = [
  {
    key: 'content_editor',
    name: 'Content editor',
    description:
      'Writes and publishes recipes, and manages their images. Cannot see a single customer record. Note that image generation spends money at OpenAI.',
    scopes: ['recipes:write', 'images:write', 'decide:read'],
  },
  {
    key: 'support',
    name: 'Support',
    description:
      'Answers customers and can suspend an abuser. Can read the email log to see what somebody was sent. Cannot publish content or send a broadcast.',
    scopes: ['users:read', 'users:write', 'emails:read', 'jobs:read', 'recipes:read'],
  },
  {
    key: 'analyst',
    name: 'Analyst',
    description:
      'Read-only everywhere. The group to hand out freely — it cannot change anything. Includes the AI audit, which can contain what users typed into chat.',
    scopes: ['decide:read', 'ai:read', 'recipes:read', 'jobs:read', 'emails:read'],
  },
  {
    key: 'operator',
    name: 'Operator',
    description:
      'A trusted senior. Everything except managing staff and changing settings — so they still cannot grant themselves more, or switch the mail provider.',
    scopes: [
      'recipes:delete',
      'images:delete',
      'users:write',
      'emails:write',
      'ai:read',
      'jobs:write',
      'flags:write',
      'decide:read',
      'chowdeck:delete',
      'audit:read',
      // Can SEE what operations exist and what they last returned; running one
      // is `scripts:write`, which stays with the owner.
      'scripts:read',
    ],
  },
];

/**
 * The two scopes only a super admin may grant.
 *
 * Both are escalation paths: `staff:write` lets somebody edit permissions
 * (including their own colleagues' into their own), and `settings:write`
 * reaches the mail provider and the ranking that decides what every user is
 * offered. They stay with the owner.
 */
export const OWNER_ONLY_SCOPES: readonly Scope[] = [
  'staff:write',
  'settings:write',
  // Running an operation rewrites data across the whole database. Reading the
  // list is separate and can be granted on its own.
  'scripts:write',
];
