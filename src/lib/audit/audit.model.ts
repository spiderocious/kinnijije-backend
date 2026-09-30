import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * What staff did, kept.
 *
 * Distinct from every other log in the system: `ai_logs` records model calls,
 * `email_logs` records sends, `decide_logs` records anonymous decisions. None
 * of them answers "who changed this recipe's status, and what did it say
 * before?" — which is the only question this collection exists for.
 *
 * NO TTL INDEX, deliberately. Unlike `password_resets`, this collection's
 * whole value is that it is old. Deleting audit history on a timer is the one
 * thing an audit trail must never do quietly.
 */
export interface AuditLogAttributes {
  _id: string;

  // ── Who ──
  actorId: string;
  /**
   * DENORMALISED on purpose.
   *
   * A trail that renders "u_01M3T… did X" is unreadable, and joining to an
   * account that has since been deleted renders nothing at all. The point of
   * this collection is to outlive what it describes, so identity is captured
   * at the moment of the act rather than looked up later.
   */
  actorEmail: string;
  actorRole: string;

  // ── What ──
  /** Dotted and past-tense: `recipes.status.changed`. Stable; charts group on it. */
  action: string;
  resource: string;
  resourceId: string | null;
  /**
   * Only the fields that moved, with both values. Never a whole document.
   *
   * A trail without the old value cannot answer the question people actually
   * ask, which is "what did it say before?".
   */
  changes: { field: string; from: unknown; to: unknown }[] | null;
  /** Free-form extras for actions with no before/after — a broadcast's audience size. */
  meta: Record<string, unknown> | null;

  // ── How it went ──
  outcome: 'success' | 'denied' | 'error';

  // ── Where from ──
  method: string;
  path: string;
  /** Joins to the HTTP log line for the same request. */
  requestId: string;
  /** Salted hash, never the address — same treatment as `decide_logs`. */
  ipHash: string | null;
  userAgent: string | null;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogAttributes>(
  {
    _id: { type: String, default: () => newId('audit') },
    actorId: { type: String, required: true, index: true },
    actorEmail: { type: String, required: true },
    actorRole: { type: String, required: true },

    action: { type: String, required: true, index: true },
    resource: { type: String, required: true, index: true },
    resourceId: { type: String, default: null, index: true },
    changes: { type: Schema.Types.Mixed, default: null },
    meta: { type: Schema.Types.Mixed, default: null },

    outcome: { type: String, required: true, enum: ['success', 'denied', 'error'], index: true },

    method: { type: String, required: true },
    path: { type: String, required: true },
    requestId: { type: String, required: true },
    ipHash: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'audit_logs',
  },
);

// The default view: everything, newest first.
auditLogSchema.index({ createdAt: -1 });
// "what has this person been doing" — the second-most-asked question.
auditLogSchema.index({ actorId: 1, createdAt: -1 });
// "who touched this recipe" — the first.
auditLogSchema.index({ resource: 1, resourceId: 1, createdAt: -1 });
// The interesting one: somebody probing what they cannot reach.
auditLogSchema.index({ outcome: 1, createdAt: -1 });

export type AuditLogDocument = HydratedDocument<AuditLogAttributes>;
export const AuditLogModel = model<AuditLogAttributes>('AuditLog', auditLogSchema);
