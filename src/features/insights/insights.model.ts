import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * The cached AI reading of somebody's week.
 *
 * Recomputed at most hourly, and only when the underlying data actually
 * changed — `dataFingerprint` is what makes that check cheap. Without it we
 * would pay for a model call every time somebody opened the screen.
 */
export interface WeekInsightAttributes {
  _id: string;
  ownerId: string;
  /** Derived from what was cooked and moved. Same fingerprint = same answer. */
  dataFingerprint: string;
  payload: unknown;
  computedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const weekInsightSchema = new Schema<WeekInsightAttributes>(
  {
    _id: { type: String, default: () => newId('insight') },
    ownerId: { type: String, required: true, unique: true },
    dataFingerprint: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: null },
    computedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, versionKey: false, collection: 'week_insights' },
);

export type WeekInsightDocument = HydratedDocument<WeekInsightAttributes>;
export const WeekInsightModel = model<WeekInsightAttributes>('WeekInsight', weekInsightSchema);
