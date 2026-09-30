import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * A signed-in cook's own decisions, kept so they can look back at them.
 *
 * DELIBERATELY SEPARATE from `decide_logs`, which is the analytics table and
 * states in its own header that it identifies nobody: the IP is a salted hash
 * precisely so a row cannot be traced to a person. Adding an owner column
 * there would quietly retract that promise for every row in the collection.
 *
 * So ownership lives here instead. Two consequences worth knowing:
 *   - a guest writes NOTHING to this collection. No account, no history.
 *   - the two tables are written in the same request and can drift if one
 *     write fails. That is accepted: analytics must never be blocked by a
 *     convenience feature, so this write is best-effort and logged, never
 *     awaited in a way that can fail the decision itself.
 *
 * It stores the ANSWERS, not just the outcome — that is what makes "remix"
 * possible, because the flow can be seeded from a past row and re-run.
 */
export interface DecideHistoryAttributes {
  _id: string;
  /** The owner. Always set: this collection has no anonymous rows. */
  ownerId: string;

  // ── What they told us. Enough to replay the decision exactly. ──
  kitchenItems: string[];
  kitchenSkipped: boolean;
  mood: string;
  weight: string;
  minutes: number;
  city: string | null;
  /** `cook` or `order`. */
  mode: string;

  // ── What we said ──
  /** Null when nothing matched. A row is still kept: "nothing" is a result. */
  verdictMealId: string | null;
  verdictName: string | null;
  verdictScore: number | null;
  /** The sentence shown, whoever wrote it. */
  why: string | null;
  /** The runners-up, so the saved verdict can be re-shown as it appeared. */
  poolMealIds: string[];

  createdAt: Date;
}

const decideHistorySchema = new Schema<DecideHistoryAttributes>(
  {
    _id: { type: String, default: () => newId('decideHistory') },
    ownerId: { type: String, required: true, index: true },

    kitchenItems: { type: [String], default: [] },
    kitchenSkipped: { type: Boolean, required: true, default: false },
    mood: { type: String, required: true },
    weight: { type: String, required: true },
    minutes: { type: Number, required: true },
    city: { type: String, default: null },
    mode: { type: String, required: true, default: 'cook' },

    verdictMealId: { type: String, default: null },
    verdictName: { type: String, default: null },
    verdictScore: { type: Number, default: null },
    why: { type: String, default: null },
    poolMealIds: { type: [String], default: [] },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'decide_history',
  },
);

// The only read this collection serves: one cook's rows, newest first.
decideHistorySchema.index({ ownerId: 1, createdAt: -1 });

export type DecideHistoryDocument = HydratedDocument<DecideHistoryAttributes>;
export const DecideHistoryModel = model<DecideHistoryAttributes>(
  'DecideHistory',
  decideHistorySchema,
);
