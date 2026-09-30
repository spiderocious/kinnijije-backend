import { model, Schema, type HydratedDocument } from 'mongoose';

/**
 * Where the tuned ranking config lives.
 *
 * A single document, so there is exactly one answer to "how is ranking
 * configured" and no chance of two rows disagreeing. Its `_id` is a constant
 * rather than generated, which is what makes the upsert idempotent.
 *
 * Stored as `Mixed` on purpose: the SHAPE is owned by the Zod schema in
 * `ranking.config.ts`, and duplicating it here would mean two definitions
 * drifting apart. Everything read out of this collection goes through
 * `resolveRankingConfig`, which validates and fills gaps.
 */
export const RANKING_CONFIG_ID = 'ranking';

export interface RankingSettingsAttributes {
  _id: string;
  config: unknown;
  updatedBy: string | null;
  updatedAt: Date;
}

const rankingSettingsSchema = new Schema<RankingSettingsAttributes>(
  {
    _id: { type: String, required: true },
    config: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: String, default: null },
  },
  { timestamps: { createdAt: false, updatedAt: true }, versionKey: false, collection: 'app_settings' },
);

export type RankingSettingsDocument = HydratedDocument<RankingSettingsAttributes>;
export const RankingSettingsModel = model<RankingSettingsAttributes>(
  'RankingSettings',
  rankingSettingsSchema,
);
