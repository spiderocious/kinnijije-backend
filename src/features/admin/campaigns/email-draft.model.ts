import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * One person's copy of one batch, rendered but not sent.
 *
 * Stores the FINAL rendered subject/html/text rather than re-rendering at send
 * time — because an operator may have edited it, and a send that re-rendered
 * would silently discard the edit.
 */

export const DRAFT_STATUSES = {
  DRAFT: 'draft',
  /** An operator changed the copy for this person. */
  EDITED: 'edited',
  /** Pulled from the batch. Never sent. */
  EXCLUDED: 'excluded',
  SENT: 'sent',
  FAILED: 'failed',
} as const;

export type DraftStatus = (typeof DRAFT_STATUSES)[keyof typeof DRAFT_STATUSES];

export interface EmailDraftAttributes {
  _id: string;
  batchId: string;
  ownerId: string;
  email: string;
  name: string | null;
  subject: string;
  html: string;
  text: string;
  /**
   * What it was built from — stock count, expiring items, chosen meals.
   *
   * Lets a reviewer see WHY an email says what it says without re-running the
   * build, which is the difference between reviewing and guessing.
   */
  inputs: Record<string, unknown>;
  /**
   * SHA-256 of the body, truncated.
   *
   * The review screen groups by this to surface near-identical copy — which is
   * exactly the bug that prompted the whole pipeline. Without it, four hundred
   * identical emails look like four hundred fine emails.
   */
  bodyHash: string;
  status: DraftStatus;
  excludedReason: string | null;
  /** Staff id. */
  editedBy: string | null;
  /** Set once sent, so the log row can be found from here. */
  emailLogId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const emailDraftSchema = new Schema<EmailDraftAttributes>(
  {
    _id: { type: String, default: () => newId('draft') },
    batchId: { type: String, required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    email: { type: String, required: true },
    name: { type: String, default: null },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String, required: true },
    inputs: { type: Schema.Types.Mixed, default: {} },
    bodyHash: { type: String, required: true, index: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(DRAFT_STATUSES),
      default: DRAFT_STATUSES.DRAFT,
      index: true,
    },
    excludedReason: { type: String, default: null },
    editedBy: { type: String, default: null },
    emailLogId: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'email_drafts' },
);

// The review screen: one batch, in order.
emailDraftSchema.index({ batchId: 1, createdAt: 1 });
// The duplicate-detection query: how many drafts share this body?
emailDraftSchema.index({ batchId: 1, bodyHash: 1 });

export type EmailDraftDocument = HydratedDocument<EmailDraftAttributes>;
export const EmailDraftModel = model<EmailDraftAttributes>('EmailDraft', emailDraftSchema);
