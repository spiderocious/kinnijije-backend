import { model, Schema, type HydratedDocument } from 'mongoose';

/**
 * Every feature that can be switched off, and what it means when it is.
 *
 * The DESCRIPTION is part of the definition rather than living in the console,
 * because the person turning something off needs to know what breaks — and a
 * label written next to the switch drifts from the code that reads the flag.
 */
export const FEATURE_FLAGS = {
  ONBOARDING_TOUR: 'onboarding_tour',
  UPLOAD_RECEIPT: 'upload_receipt',
  UPLOAD_PHOTO: 'upload_photo',
} as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

export interface FlagDefinition {
  readonly key: FeatureFlag;
  readonly label: string;
  /** What actually stops happening. Shown beside the switch. */
  readonly whenOff: string;
}

export const FLAG_DEFINITIONS: readonly FlagDefinition[] = [
  {
    key: FEATURE_FLAGS.ONBOARDING_TOUR,
    label: 'The product tour',
    whenOff: 'New cooks land straight on their kitchen with no coach marks.',
  },
  {
    key: FEATURE_FLAGS.UPLOAD_RECEIPT,
    label: 'Reading a market receipt',
    whenOff: 'The receipt option disappears from the add-stock screen. Typing and photos still work.',
  },
  {
    key: FEATURE_FLAGS.UPLOAD_PHOTO,
    label: 'Reading a photo of a shelf',
    whenOff: 'The photo option disappears from the add-stock screen. Typing still works.',
  },
];

/**
 * One switch.
 *
 * A row exists only once somebody has TOUCHED that flag — absence means ON.
 * A new flag therefore ships enabled without a migration, and turning one off
 * is an explicit, recorded act with a person's name against it.
 */
export interface FlagAttributes {
  _id: FeatureFlag;
  enabled: boolean;
  updatedBy: string | null;
  reason: string | null;
  updatedAt: Date;
}

const flagSchema = new Schema<FlagAttributes>(
  {
    _id: { type: String, required: true, enum: Object.values(FEATURE_FLAGS) },
    enabled: { type: Boolean, required: true, default: true },
    updatedBy: { type: String, default: null },
    reason: { type: String, default: null },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
    collection: 'feature_flags',
  },
);

export type FlagDocument = HydratedDocument<FlagAttributes>;
export const FlagModel = model<FlagAttributes>('FeatureFlag', flagSchema);
