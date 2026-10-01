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
   * A one-off. Once it has SUCCEEDED for real, Run is disabled rather than
   * hidden — an operator needs to see that it exists and that it is already
   * done, or they will go looking for it. Dry runs never count.
   */
  readonly runOnce: boolean;
  /**
   * Undoes the last real run, where that is genuinely possible.
   *
   * Absent on purpose for most scripts: `prune-unknown-scopes` has discarded
   * the strings it removed, so there is nothing to put back. A generic "undo"
   * that silently did nothing would be worse than no button at all.
   */
  readonly revert?: (context: ScriptContext) => Promise<Record<string, unknown>>;
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
 * Turns every notification preference on, for every existing user.
 *
 * The schema defaults changed to `true`, which only affects accounts created
 * from now on — existing rows keep whatever they were stored with. This brings
 * them in line.
 *
 * UNCONDITIONAL, by decision: it sets all five for everybody, with no check for
 * whether somebody had previously turned one off. Signing up is taken as
 * wanting them; the per-kind toggle in settings and the unsubscribe header in
 * every send are how somebody opts out afterwards.
 */
const enableAllNotifications: ScriptDefinition = {
  id: 'enable-all-notifications',
  name: 'Turn on notifications for everyone',
  description:
    'Sets all five notification preferences to on for every existing user, so older accounts match the new default. Does not check whether anybody had turned one off.',
  effect: 'Overwrites all five notification preferences on every user document.',
  destructive: true,
  supportsDryRun: true,
  runOnce: true,
  run: async ({ dryRun, job }) => {
    const { UserModel } = await import('@features/users/users.model.js');

    const total = await UserModel.countDocuments().exec();
    await job.setProgress(0.4, `${String(total)} users`);

    // What would change — counted before the write, so the dry run reports the
    // same number the real run will modify.
    const alreadyOn = await UserModel.countDocuments({
      'notifications.runningLow': true,
      'notifications.useItUp': true,
      'notifications.haveYouEaten': true,
      'notifications.dailyDigest': true,
      'notifications.weeklySummary': true,
    }).exec();

    if (dryRun) {
      return {
        dry_run: true,
        total_users: total,
        already_fully_on: alreadyOn,
        would_change: total - alreadyOn,
      };
    }

    const result = await UserModel.updateMany(
      {},
      {
        $set: {
          'notifications.runningLow': true,
          'notifications.useItUp': true,
          'notifications.haveYouEaten': true,
          'notifications.dailyDigest': true,
          'notifications.weeklySummary': true,
        },
      },
    ).exec();

    return {
      total_users: total,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    };
  },
};

/**
 * Reports staff whose granted scopes no longer match the group they were
 * given.
 *
 * Groups are FLATTENED onto a staff row when assigned, deliberately — the row
 * is the single source of truth, so editing a group does not retroactively
 * change existing members. That is the right trade, but it means drift is
 * invisible without something like this.
 *
 * Read-only: whether to re-apply the group or leave a deliberate exception
 * alone is a judgement call, not something a script should make.
 */
const auditGroupDrift: ScriptDefinition = {
  id: 'audit-group-drift',
  name: 'Find permission drift',
  description:
    'Lists staff whose permissions no longer match the group assigned to them — usually because the group was edited after they were granted it.',
  effect: 'Reads only. Changes nothing.',
  destructive: false,
  supportsDryRun: false,
  runOnce: false,
  run: async () => {
    const { StaffUserModel } = await import('../staff/staff-user.model.js');
    const { SEEDED_GROUPS } = await import('@shared/constants/permission-groups.js');

    const staff = await StaffUserModel.find(
      { permissionGroupKeys: { $ne: [] } },
      { email: 1, permissions: 1, permissionGroupKeys: 1 },
    )
      .lean()
      .exec();

    const drifted = staff
      .map((row) => {
        const expected = new Set<string>(
          row.permissionGroupKeys.flatMap(
            (key): readonly string[] =>
              SEEDED_GROUPS.find((group) => group.key === key)?.scopes ?? [],
          ),
        );
        const held = new Set<string>(row.permissions);
        return {
          email: row.email,
          groups: row.permissionGroupKeys,
          missing: [...expected].filter((scope) => !held.has(scope)),
          extra: [...held].filter((scope) => !expected.has(scope)),
        };
      })
      .filter((row) => row.missing.length > 0 || row.extra.length > 0);

    return { checked: staff.length, drifted_count: drifted.length, drifted };
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
  // A report. Run it whenever.
  runOnce: false,
  description:
    'Lists accounts still marked invited whose invitation has expired or been revoked — people who were invited and can no longer accept.',
  effect: 'Reads only. Changes nothing.',
  destructive: false,
  supportsDryRun: false,
  run: async () => {
    const { StaffInviteModel } = await import('../staff/staff-invite.model.js');
    const { STAFF_STATUSES, StaffUserModel } = await import('../staff/staff-user.model.js');

    const invited = await StaffUserModel.find(
      { status: STAFF_STATUSES.INVITED },
      { email: 1, name: 1, createdAt: 1 },
    )
      .lean()
      .exec();

    const open = await StaffInviteModel.find(
      {
        staffId: { $in: invited.map((row) => row._id) },
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { staffId: 1 },
    )
      .lean()
      .exec();

    const withOpenInvite = new Set(open.map((row) => row.staffId));
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
  runOnce: false,
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

/**
 * Puts a new member's onboarding kitchen into their actual stock.
 *
 * THE BUG IT REPAIRS: `onboarding.patch` writes the answer to
 * `user.kitchenItems` and stops there. Nothing ever creates the stock rows —
 * and the Kitchen page, the signed-in Decide pre-fill and the server's own
 * fallback all read STOCK. So somebody answered "what do you have", saw an
 * empty kitchen afterwards, and was asked the same question again.
 *
 * 114 of 145 accounts were in that state when this was written.
 *
 * Uses `stockService.seedFromNames`, which is the same call the decide
 * carry-over makes: it resolves each name against the catalogue, writes one of
 * the default unit as a placeholder, records a movement, and SKIPS anything
 * already in stock. That last part is what makes this safe to run twice.
 *
 * Not `runOnce`: accounts created before the underlying fix ships will keep
 * arriving in this state, so an operator may need it again.
 */
const backfillOnboardingKitchens: ScriptDefinition = {
  id: 'backfill-onboarding-kitchens',
  name: 'Move onboarding kitchens into stock',
  runOnce: false,
  description:
    'Finds accounts whose onboarding kitchen answers never became stock rows, and creates the missing rows. Anything already in stock is left exactly as it is.',
  effect:
    'Creates one stock row per remembered ingredient, at one of its default unit. Never overwrites or removes anything.',
  // It only ever adds, and only what the person already told us.
  destructive: false,
  supportsDryRun: true,
  run: async ({ job, dryRun }) => {
    const { UserModel } = await import('@features/users/users.model.js');
    const { StockItemModel } = await import('@features/stock/stock.model.js');
    const { stockService } = await import('@features/stock/stock.service.js');
    const { STOCK_SOURCES } = await import('@features/stock/stock.model.js');

    const candidates = await UserModel.find(
      { 'kitchenItems.0': { $exists: true } },
      { _id: 1, email: 1, kitchenItems: 1 },
    )
      .lean()
      .exec();

    const repaired: { id: string; email: string; items: number; added: number }[] = [];
    let alreadyFine = 0;
    let itemsAdded = 0;

    for (const [index, user] of candidates.entries()) {
      await job.setProgress(index / Math.max(1, candidates.length), user.email);

      const names = user.kitchenItems ?? [];

      /**
       * Only accounts with NO stock at all.
       *
       * Somebody who has since added things has a kitchen they have curated,
       * and quietly pushing a months-old onboarding answer back into it would
       * resurrect ingredients they may have deliberately removed. The narrow
       * rule repairs the reported failure and touches nobody else.
       */
      const existing = await StockItemModel.countDocuments({ ownerId: user._id }).exec();
      if (existing > 0) {
        alreadyFine += 1;
        continue;
      }

      if (dryRun) {
        repaired.push({ id: user._id, email: user.email, items: names.length, added: 0 });
        itemsAdded += names.length;
        continue;
      }

      const result = await stockService.seedFromNames(
        user._id,
        names,
        STOCK_SOURCES.ONBOARDING,
      );
      const added = result.success ? result.data.added : 0;
      itemsAdded += added;
      repaired.push({ id: user._id, email: user.email, items: names.length, added });
    }

    return {
      dry_run: dryRun,
      accounts_with_remembered_kitchens: candidates.length,
      accounts_repaired: repaired.length,
      accounts_already_had_stock: alreadyFine,
      stock_rows_created: itemsAdded,
      // Capped: a console cell is not a place to render 114 rows.
      sample: repaired.slice(0, 20),
    };
  },
};

export const SCRIPTS: readonly ScriptDefinition[] = [
  enableAllNotifications,
  auditGroupDrift,
  auditStuckInvites,
  pruneUnknownScopes,
  backfillOnboardingKitchens,
];

export const scriptById = (id: string): ScriptDefinition | undefined =>
  SCRIPTS.find((script) => script.id === id);
