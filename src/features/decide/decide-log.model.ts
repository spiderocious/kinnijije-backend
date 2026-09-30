import { createHash } from 'node:crypto';

import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * Every anonymous decision, recorded.
 *
 * The AI log already captures model calls, but it cannot answer the questions
 * that actually matter about this flow: what people SAID they had, what came
 * back when the model was never called, how often a shortlist was empty, and
 * which dishes get refused. Those are properties of the decision, not of a
 * prompt, so they need their own row.
 *
 * NO PERSONAL DATA. A guest has no account, and this must not quietly become a
 * way to build a profile of one:
 *   - the IP is stored as a salted hash, never raw, so repeat usage is
 *     countable but a person is not identifiable or reversible
 *   - the city is kept because it is a coarse region, freely given, and it is
 *     the one input whose effect on ranking we need to be able to audit
 *   - nothing else about the request is retained
 */

export interface DecideLogAttributes {
  _id: string;
  /** Ties a row to its HTTP log line without storing anything about the person. */
  requestId: string;
  /** Salted hash. Counts repeat usage; identifies nobody. */
  ipHash: string;

  // ── What they told us ──
  kitchenItems: string[];
  kitchenSkipped: boolean;
  mood: string;
  weight: string;
  minutes: number;
  city: string | null;
  /** Meals refused earlier in the same session. */
  rejected: string[];

  // ── What we said ──
  /** Null when nothing matched at all. */
  verdictMealId: string | null;
  verdictName: string | null;
  /** The deterministic match score of the winner, 0–1. */
  verdictScore: number | null;
  /** How many candidates survived filtering. 0 means the shortlist was empty. */
  poolSize: number;
  /** `ai_framed` or `deterministic` — how often the model actually contributed. */
  provenance: string;
  /** The sentence shown, whoever wrote it. */
  why: string | null;

  // ── How it went ──
  durationMs: number;
  /** Set when the model was called but its answer was not used. */
  aiFallbackReason: string | null;
  createdAt: Date;
}

const decideLogSchema = new Schema<DecideLogAttributes>(
  {
    _id: { type: String, default: () => newId('decideLog') },
    requestId: { type: String, required: true },
    ipHash: { type: String, required: true, index: true },

    kitchenItems: { type: [String], default: [] },
    kitchenSkipped: { type: Boolean, required: true, default: false },
    mood: { type: String, required: true, index: true },
    weight: { type: String, required: true, index: true },
    minutes: { type: Number, required: true },
    city: { type: String, default: null },
    rejected: { type: [String], default: [] },

    verdictMealId: { type: String, default: null, index: true },
    verdictName: { type: String, default: null },
    verdictScore: { type: Number, default: null },
    poolSize: { type: Number, required: true, default: 0 },
    provenance: { type: String, required: true, index: true },
    why: { type: String, default: null },

    durationMs: { type: Number, required: true, default: 0 },
    aiFallbackReason: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'decide_logs',
  },
);

// The console reads this newest-first, always.
decideLogSchema.index({ createdAt: -1 });
// "what did people ask for on Tuesday" is a range scan per dimension.
decideLogSchema.index({ mood: 1, createdAt: -1 });
decideLogSchema.index({ provenance: 1, createdAt: -1 });

export type DecideLogDocument = HydratedDocument<DecideLogAttributes>;
export const DecideLogModel = model<DecideLogAttributes>('DecideLog', decideLogSchema);

/**
 * A stable, non-reversible fingerprint for an IP.
 *
 * Salted with a server secret so the hashes cannot be reversed with a rainbow
 * table over the whole IPv4 space, which a bare SHA-256 of an IP absolutely
 * can be. Truncated because we only need to count repeats, not be certain.
 */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 16);
}
