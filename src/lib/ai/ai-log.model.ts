import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * Every single call to a model, recorded.
 *
 * Written at the SERVICE layer, not inside a provider — so it captures the call
 * regardless of which provider answered, and a new provider cannot forget to
 * log. That placement is the whole reason this is trustworthy.
 *
 * What it is for:
 *   - Cost. Tokens per prompt id, per day, per model.
 *   - Tuning. `metrics.tuneSuggestion` and low confidence scores say which
 *     prompt is failing, in the model's own words.
 *   - Blame. When a read is wrong, the exact prompt and reply are here.
 */
export interface AiLogAttributes {
  _id: string;
  promptId: string;
  provider: string;
  model: string;
  ownerId: string | null;
  /** The system prompt, verbatim. */
  systemPrompt: string;
  /** The user message, verbatim. Images are recorded by reference, never inline. */
  userPrompt: string;
  /** File ids of any images sent — the bytes stay in storage. */
  imageRefs: string[];
  /** Raw text the model returned, before parsing. */
  rawResponse: string | null;
  /** Whether it survived zod. A false here with a raw response is a prompt bug. */
  parsed: boolean;
  parseError: string | null;
  /** The model's self-graded metrics. Never leaves this collection. */
  metrics: Record<string, unknown> | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
  ok: boolean;
  error: string | null;
  createdAt: Date;
}

const aiLogSchema = new Schema<AiLogAttributes>(
  {
    _id: { type: String, default: () => newId('ailog') },
    promptId: { type: String, required: true, index: true },
    provider: { type: String, required: true, index: true },
    model: { type: String, required: true },
    ownerId: { type: String, default: null, index: true },
    systemPrompt: { type: String, required: true },
    userPrompt: { type: String, required: true },
    imageRefs: { type: [String], default: [] },
    rawResponse: { type: String, default: null },
    parsed: { type: Boolean, required: true, default: false },
    parseError: { type: String, default: null },
    metrics: { type: Schema.Types.Mixed, default: null },
    promptTokens: { type: Number, default: null },
    completionTokens: { type: Number, default: null },
    totalTokens: { type: Number, default: null },
    durationMs: { type: Number, required: true },
    ok: { type: Boolean, required: true },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'ai_logs' },
);

// The tuning query: everything for one prompt, newest first.
aiLogSchema.index({ promptId: 1, createdAt: -1 });
// The failure query: what is not parsing.
aiLogSchema.index({ parsed: 1, createdAt: -1 });

export type AiLogDocument = HydratedDocument<AiLogAttributes>;

export const AiLogModel = model<AiLogAttributes>('AiLog', aiLogSchema);
