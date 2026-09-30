import type { JobContext } from '@lib/jobs/jobs.types.js';

/**
 * Operations an operator can run from the console.
 *
 * WHY THIS EXISTS: production has no shell. A migration written as
 * `pnpm migrate:permissions` is a migration that cannot be run where it is
 * needed, so the things that used to be one-off scripts live here instead —
 * declared, permissioned, audited, and executed through the job queue like any
 * other background work.
 *
 * THE RULES for anything added here:
 *
 *   1. **Idempotent.** An operator will run it twice. The second run must be
 *      safe, and should report that it changed nothing.
 *   2. **Reports what it did**, as a plain object. "Done" is not a result;
 *      `{ matched: 12, modified: 3 }` is.
 *   3. **Supports `dryRun`** where it writes. The first thing anybody wants to
 *      know is what WOULD happen.
 *   4. **Destructive scripts are marked.** The console makes those confirm.
 *
 * A script is NOT a place to put arbitrary code an operator supplies. Nothing
 * here evaluates input — the id selects from this closed list and the payload
 * is validated. Anything else would be a remote code execution endpoint with a
 * permission check in front of it.
 */

export interface ScriptContext {
  /** Progress reporting and cancellation, from the job that is running this. */
  readonly job: JobContext;
  /** Whether to report without writing. Honoured by every writing script. */
  readonly dryRun: boolean;
}

export interface ScriptDefinition {
  readonly id: string;
  readonly name: string;
  /** What it does, in a sentence an operator can act on. */
  readonly description: string;
  /**
   * What it changes when it is not a dry run. Shown beside the button —
   * the same convention as a feature flag's `whenOff`.
   */
  readonly effect: string;
  /** True when it removes or overwrites data. The console demands confirmation. */
  readonly destructive: boolean;
  /** Whether `dryRun` does anything. False for a read-only report. */
  readonly supportsDryRun: boolean;
  readonly run: (context: ScriptContext) => Promise<Record<string, unknown>>;
}

/**
 * Backfills permission scopes onto existing admins.
 *
 * This was `scripts/migrate-admin-permissions.ts`. It has to run exactly once,
 * immediately after scope enforcement deploys, or every existing admin locks
 * out on their next request — which makes "you cannot run scripts on prod" a
 * genuine blocker rather than an inconvenience.
 */
const backfillAdminPermissions: ScriptDefinition = {
  id: 'backfill-admin-permissions',
  name: 'Backfill admin permissions',
  description:
    'Gives every existing admin the Operator scope set, so nobody is locked out when scope enforcement goes live. Super admins are skipped — they bypass scope checks rather than holding them.',
  effect: 'Sets permissions on admin accounts that currently have none.',
  destructive: false,
  supportsDryRun: true,
  run: async ({ dryRun, job }) => {
    const { UserModel } = await import('@features/users/users.model.js');
    const { SEEDED_GROUPS } = await import('@shared/constants/permission-groups.js');
    const { USER_ROLES } = await import('@shared/constants/roles.js');

    const operator = SEEDED_GROUPS.find((group) => group.key === 'operator');
    if (operator === undefined) throw new Error('the operator group is missing from the seed');

    // Only an EMPTY set is filled, so re-running cannot clobber a set somebody
    // has since narrowed by hand.
    const filter = {
      role: USER_ROLES.ADMIN,
      $or: [{ permissions: { $size: 0 } }, { permissions: { $exists: false } }],
    };

    const candidates = await UserModel.find(filter, { email: 1 }).lean().exec();
    await job.setProgress(0.5, `${String(candidates.length)} to update`);

    if (dryRun) {
      return {
        dry_run: true,
        would_update: candidates.length,
        emails: candidates.map((row) => row.email),
        scopes: [...operator.scopes],
      };
    }

    const result = await UserModel.updateMany(filter, {
      $set: { permissions: [...operator.scopes], permissionGroupKeys: [operator.key] },
    }).exec();

    return {
      matched: result.matchedCount,
      modified: result.modifiedCount,
      group: operator.key,
      scopes: [...operator.scopes],
    };
  },
};

/**
 * Finds accounts that cannot sign in and cannot be invited either.
 *
 * A read-only report rather than a fix: an invited row with no open invite is
 * usually somebody whose link expired, and whether to re-invite or delete them
 * is a judgement call, not something a script should decide.
 */
const auditStuckInvites: ScriptDefinition = {
  id: 'audit-stuck-invites',
  name: 'Find stranded invitations',
  description:
    'Lists accounts still marked invited whose invitation has expired or been revoked — people who were invited and can no longer accept.',
  effect: 'Reads only. Changes nothing.',
  destructive: false,
  supportsDryRun: false,
  run: async () => {
    const { UserModel } = await import('@features/users/users.model.js');
    const { StaffInviteModel } = await import('../staff/staff-invite.model.js');
    const { USER_STATUSES } = await import('@shared/constants/roles.js');

    const invited = await UserModel.find(
      { status: USER_STATUSES.INVITED },
      { email: 1, name: 1, createdAt: 1 },
    )
      .lean()
      .exec();

    const open = await StaffInviteModel.find(
      {
        userId: { $in: invited.map((row) => row._id) },
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { userId: 1 },
    )
      .lean()
      .exec();

    const withOpenInvite = new Set(open.map((row) => row.userId));
    const stranded = invited.filter((row) => !withOpenInvite.has(row._id));

    return {
      invited_total: invited.length,
      stranded_count: stranded.length,
      stranded: stranded.map((row) => ({
        id: row._id,
        email: row.email,
        name: row.name,
        invited_at: row.createdAt?.toISOString() ?? null,
      })),
    };
  },
};

/**
 * Drops permission scopes that no longer exist in the code.
 *
 * Renaming or removing a resource leaves dead strings on user documents. They
 * are harmless — `satisfies` only ever matches real scopes — but they make the
 * console's permission editor show grants that do nothing, which is confusing
 * at exactly the wrong moment.
 */
const pruneUnknownScopes: ScriptDefinition = {
  id: 'prune-unknown-scopes',
  name: 'Prune unknown permission scopes',
  description:
    'Removes permission strings that are no longer defined in the code — left behind when a resource is renamed or removed.',
  effect: 'Rewrites the permissions array on any account holding a scope that no longer exists.',
  destructive: true,
  supportsDryRun: true,
  run: async ({ dryRun }) => {
    const { UserModel } = await import('@features/users/users.model.js');
    const { isScope } = await import('@shared/constants/permissions.js');

    const holders = await UserModel.find(
      { permissions: { $exists: true, $ne: [] } },
      { email: 1, permissions: 1 },
    )
      .lean()
      .exec();

    const affected = holders
      .map((row) => {
        const kept = (row.permissions ?? []).filter((scope) => isScope(scope));
        const dropped = (row.permissions ?? []).filter((scope) => !isScope(scope));
        return { id: row._id, email: row.email, kept, dropped };
      })
      .filter((row) => row.dropped.length > 0);

    if (dryRun) {
      return {
        dry_run: true,
        would_change: affected.length,
        detail: affected.map((row) => ({ email: row.email, dropped: row.dropped })),
      };
    }

    for (const row of affected) {
      await UserModel.updateOne({ _id: row.id }, { $set: { permissions: row.kept } }).exec();
    }

    return {
      changed: affected.length,
      detail: affected.map((row) => ({ email: row.email, dropped: row.dropped })),
    };
  },
};

export const SCRIPTS: readonly ScriptDefinition[] = [
  backfillAdminPermissions,
  auditStuckInvites,
  pruneUnknownScopes,
];

export const scriptById = (id: string): ScriptDefinition | undefined =>
  SCRIPTS.find((script) => script.id === id);
