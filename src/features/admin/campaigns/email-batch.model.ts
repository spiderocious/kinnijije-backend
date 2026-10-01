import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';
import { EMAIL_KINDS, type EmailKind } from '@lib/mail/email-log.model.js';

/**
 * A run of one automated kind, drafted but not yet sent.
 *
 * The sweep stops sending and starts DRAFTING into one of these. Somebody opens
 * it, reads what each person would get, edits or excludes, and approves — and
 * only approval sends.
 *
 * Why a batch at all rather than reviewing individual drafts: the interesting
 * question is never "is this one email right", it is "are these four hundred
 * emails all the same email" — which is the bug that prompted this. A batch is
 * the unit that question can be asked of.
 */

export const BATCH_STATUSES = {
  /** Still being built. The sweep is mid-run. */
  DRAFTING: 'drafting',
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  SENDING: 'sending',
  SENT: 'sent',
  /** Thrown away unsent. */
  DISCARDED: 'discarded',
} as const;

export type BatchStatus = (typeof BATCH_STATUSES)[keyof typeof BATCH_STATUSES];

/** How a batch came to exist. */
export const BATCH_SOURCES = {
  /** The scheduled sweep. */
  SWEEP: 'sweep',
  /** An operator built it by hand for named users — the composer. */
  COMPOSER: 'composer',
} as const;

export type BatchSource = (typeof BATCH_SOURCES)[keyof typeof BATCH_SOURCES];

export interface EmailBatchAttributes {
  _id: string;
  kind: EmailKind;
  status: BatchStatus;
  source: BatchSource;
  /** The run this belongs to. Two sweeps on one day are two batches. */
  scheduledFor: Date;
  draftCount: number;
  excludedCount: number;
  editedCount: number;
  sentCount: number;
  failedCount: number;
  /**
   * Why people were skipped, counted by reason.
   *
   * THE FEEDBACK LOOP for eligibility rules: "88 skipped: empty_kitchen" is the
   * only thing that tells an operator a floor is set wrong. Without it, rules
   * are guesswork.
   */
  skipReasons: Record<string, number>;
  /** Staff id — never a customer. */
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const emailBatchSchema = new Schema<EmailBatchAttributes>(
  {
    _id: { type: String, default: () => newId('batch') },
    kind: { type: String, required: true, enum: Object.values(EMAIL_KINDS), index: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(BATCH_STATUSES),
      default: BATCH_STATUSES.DRAFTING,
      index: true,
    },
    source: {
      type: String,
      required: true,
      enum: Object.values(BATCH_SOURCES),
      default: BATCH_SOURCES.SWEEP,
    },
    scheduledFor: { type: Date, required: true },
    draftCount: { type: Number, required: true, default: 0 },
    excludedCount: { type: Number, required: true, default: 0 },
    editedCount: { type: Number, required: true, default: 0 },
    sentCount: { type: Number, required: true, default: 0 },
    failedCount: { type: Number, required: true, default: 0 },
    skipReasons: { type: Schema.Types.Mixed, default: {} },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'email_batches' },
);

// The dashboard reads newest-first, always.
emailBatchSchema.index({ createdAt: -1 });
// "what is waiting for me" — the question the console opens on.
emailBatchSchema.index({ status: 1, createdAt: -1 });

export type EmailBatchDocument = HydratedDocument<EmailBatchAttributes>;
export const EmailBatchModel = model<EmailBatchAttributes>('EmailBatch', emailBatchSchema);
