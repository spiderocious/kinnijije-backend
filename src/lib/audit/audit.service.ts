import type { Request } from 'express';

import { getContext } from '@lib/http/request-context.js';
import { logger } from '@lib/logger/index.js';
import { hashIp } from '@features/decide/decide-log.model.js';
import { env } from '@app/env.js';

import { AuditLogModel, type AuditLogAttributes } from './audit.model.js';

/**
 * Writing the trail.
 *
 * NEVER AWAITED IN A REQUEST PATH, and every call catches. Same reasoning as
 * `decide.service.record`: a person waiting on an action must not wait on
 * bookkeeping, and a logging failure must never turn a successful change into
 * a 500. The catch is what makes that true rather than aspirational.
 *
 * The actor comes from the AsyncLocalStorage context that already carries
 * identity to any depth, so a service records without taking `req` as an
 * argument and without a signature change anywhere.
 */

export interface AuditChange {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
}

export interface AuditInput {
  readonly action: string;
  readonly resource: string;
  readonly resourceId?: string | null;
  readonly changes?: readonly AuditChange[] | null;
  readonly meta?: Record<string, unknown> | null;
  readonly outcome?: AuditLogAttributes['outcome'];
  /** Only needed where the context cannot supply it — a background job. */
  readonly actor?: { id: string; email: string; role: string };
}

/**
 * Only the fields that actually moved.
 *
 * Called with the before and after documents; returns null when nothing
 * changed, so a no-op PATCH does not produce a row claiming it did something.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): AuditChange[] | null {
  const changes = fields
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, from: before[field] ?? null, to: after[field] ?? null }));

  return changes.length === 0 ? null : changes;
}

export function record(input: AuditInput): void {
  const context = getContext();
  const actorId = input.actor?.id ?? context?.user_id;

  // No actor means this is not a staff action — a public request, or a boot
  // script. Nothing to attribute, so nothing to record.
  if (actorId === undefined) return;

  void (async () => {
    try {
      // The email is not in the request context, so it is read once here. This
      // is off the response path (nothing awaits this function), so the extra
      // lookup costs the person nothing.
      let actorEmail = input.actor?.email;
      let actorRole = input.actor?.role ?? context?.role;

      if (actorEmail === undefined) {
        // Resolved from STAFF, because every audited action is a console
        // action. A customer id here would be a bug, and rendering 'unknown'
        // is the honest outcome rather than inventing an identity.
        const { StaffUserModel } = await import('@features/admin/staff/staff-user.model.js');
        const row = await StaffUserModel.findById(actorId, { email: 1, tier: 1 }).lean().exec();
        actorEmail = row?.email ?? 'unknown';
        actorRole ??= row?.tier ?? 'unknown';
      }

      await AuditLogModel.create({
        actorId,
        actorEmail,
        actorRole: actorRole ?? 'unknown',
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? null,
        changes: input.changes === undefined ? null : (input.changes as AuditChange[] | null),
        meta: input.meta ?? null,
        outcome: input.outcome ?? 'success',
        method: context?.method ?? '-',
        path: context?.path ?? '-',
        requestId: context?.request_id ?? '-',
        ipHash: null,
        userAgent: null,
      });
    } catch (error) {
      logger.warn('audit write failed', {
        action: input.action,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  })();
}

/**
 * A refused action.
 *
 * The most interesting rows this collection will produce: a staff member
 * repeatedly probing what they cannot reach is a signal no other log carries.
 * Takes `req` because it is called from middleware, where the IP is to hand.
 */
export function auditDenial(req: Request, neededScope: string): void {
  const context = getContext();
  if (context?.user_id === undefined) return;

  void (async () => {
    try {
      const { StaffUserModel } = await import('@features/admin/staff/staff-user.model.js');
      const row = await StaffUserModel.findById(context.user_id, { email: 1, tier: 1 })
        .lean()
        .exec();

      await AuditLogModel.create({
        actorId: context.user_id,
        actorEmail: row?.email ?? 'unknown',
        actorRole: row?.tier ?? 'unknown',
        action: 'access.denied',
        resource: neededScope.slice(0, neededScope.indexOf(':')),
        resourceId: null,
        changes: null,
        meta: { needed_scope: neededScope },
        outcome: 'denied',
        method: context.method,
        path: context.path,
        requestId: context.request_id,
        // Salted, never the raw address — same treatment as `decide_logs`.
        ipHash: hashIp(req.ip ?? 'unknown', env.JWT_ACCESS_SECRET),
        userAgent: req.header('user-agent') ?? null,
      });
    } catch (error) {
      logger.warn('audit denial write failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  })();
}

/**
 * A read of something sensitive.
 *
 * Used on FOUR routes only — one customer's record, one AI log, one email
 * body, and the trail itself. 33 of 69 admin routes are reads and a console
 * session fires dozens; logging all of them would make this collection ~95%
 * noise about people looking at dashboards, and the writes you actually care
 * about unfindable.
 *
 * Records the ACCESS, never the payload.
 */
export const auditRead =
  (resource: string, idParam: string) =>
  (req: Request, _res: unknown, next: () => void): void => {
    const params = req.params as Record<string, string | undefined>;
    record({
      action: `${resource}.read`,
      resource,
      resourceId: params[idParam] ?? null,
    });
    next();
  };
