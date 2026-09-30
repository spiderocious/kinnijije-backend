import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

export interface MealIngredient {
  /** Catalogue id where we know it — this is what matching runs on. */
  catalogueId: string | null;
  name: string;
  quantity: number | null;
  unit: string | null;
  /** A meal is still itself without it — salt, a garnish. Never counts as missing. */
  optional: boolean;
}

export interface MealStep {
  index: number;
  heading: string;
  description: string;
  estMinutes: number;
}

/**
 * One image belonging to a recipe.
 *
 * A recipe holds MANY: an uploaded photograph and a generated one can coexist,
 * a second attempt is worth keeping beside the first, and promoting a better
 * one later must not mean regenerating it. Exactly one published image is
 * primary — see `primaryImageId` below.
 *
 * Spec: backend/docs/v2/image-pipeline.html §03.
 */
export interface RecipeImage {
  _id: string;
  /** The R2 folder key. NEVER a URL — the same rule files.presenter.ts keeps. */
  key: string;
  /** How it got here. Drives the grape provenance mark shown to cooks. */
  source: 'upload' | 'generated';
  /**
   *   pending   — a row exists; the bytes may not have landed yet
   *   review    — bytes confirmed, derivatives done, not yet live
   *   published — a cook can see it
   *   rejected  — generated fine, but wrong. Kept, with its reason.
   */
  status: 'pending' | 'review' | 'published' | 'rejected';
  /** Tiny inline placeholder, ~400B. Cheaper here than as a request. */
  blurData: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  /** Generated only: exactly what we sent, so a good image is reproducible. */
  prompt: string | null;
  model: string | null;
  promptVersion: number | null;
  /** The vision pass's self-grade, for the review queue's sort order. */
  checkConfidence: number | null;
  checkReason: string | null;
  /** The job that made it, so its log is reachable from the console. */
  jobId: string | null;
  addedBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
}

/** Enough for real choice, bounded so a stuck regenerate loop cannot fill the bucket. */
export const MAX_RECIPE_IMAGES = 8;

/**
 * How complete a version of the dish this is.
 *
 * `full`    the proper preparation, as somebody would cook it for a family
 * `simple`  a real but pared-back version: fewer ingredients, still the dish
 * `minimal` what you make when you have almost nothing, and it is honest
 *           about that: boiled yam and salt is genuinely a meal, and it is
 *           genuinely not the same as yam and egg sauce
 *
 * The point is ORDERING, not filtering. A minimal version matches almost any
 * kitchen and would otherwise dominate the ranking on score alone, so quality
 * discounts it: it surfaces when nothing better is reachable, and not before.
 *
 * Absent means `full`, so every existing recipe keeps its current behaviour
 * without a migration.
 */
export const MEAL_QUALITIES = ['full', 'simple', 'minimal'] as const;
export type MealQuality = (typeof MEAL_QUALITIES)[number];

export interface MealAttributes {
  _id: string;
  slug: string;
  name: string;
  /** seed = written and checked by a person · ai = generated. Shown, always. */
  source: 'seed' | 'ai';
  status: 'draft' | 'published';
  cuisines: string[];
  difficulty: 'easy' | 'medium' | 'involved';
  cookTimeMinutes: number;
  serves: number;
  /** Why anyone cooks it. The thing a recipe database never tells you. */
  whatMakesItGood: string;
  description: string;
  ingredients: MealIngredient[];
  steps: MealStep[];
  /** Denormalised catalogue ids, so matching is a set operation not a scan. */
  ingredientKeys: string[];
  heroIcon: string | null;
  /** Absent on older documents; read through `qualityOf`, never directly. */
  quality?: MealQuality;
  /**
   * The slug of the meal this is a version of.
   *
   * Set on a variant so the full dish and its simpler forms can be collapsed
   * into one row rather than filling a shortlist with near-duplicates.
   */
  variantOf?: string | null;
  images: RecipeImage[];
  /**
   * Which image is THE image. A nullable pointer rather than an `isPrimary`
   * boolean per image: a boolean permits two primaries and zero primaries, and
   * both are states somebody then has to write code for. This can only be
   * valid or null.
   *
   * INVARIANT, enforced in the service: null, or the id of an image on this
   * recipe whose status is `published`.
   */
  primaryImageId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Declared as real sub-schemas rather than Mixed: Mixed accepts anything, which
 * means a malformed ingredient reaches the matcher and fails there instead of
 * at the write.
 */
const mealIngredientSchema = new Schema<MealIngredient>(
  {
    catalogueId: { type: String, default: null },
    name: { type: String, required: true },
    quantity: { type: Number, default: null },
    unit: { type: String, default: null },
    optional: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const mealStepSchema = new Schema<MealStep>(
  {
    index: { type: Number, required: true },
    heading: { type: String, required: true },
    description: { type: String, required: true },
    estMinutes: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const recipeImageSchema = new Schema<RecipeImage>(
  {
    _id: { type: String, default: () => newId('recipeImage') },
    key: { type: String, required: true },
    source: { type: String, required: true, enum: ['upload', 'generated'] },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'review', 'published', 'rejected'],
      default: 'pending',
    },
    blurData: { type: String, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    bytes: { type: Number, default: null },
    prompt: { type: String, default: null },
    model: { type: String, default: null },
    promptVersion: { type: Number, default: null },
    checkConfidence: { type: Number, default: null },
    checkReason: { type: String, default: null },
    jobId: { type: String, default: null },
    addedBy: { type: String, required: true },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const mealSchema = new Schema<MealAttributes>(
  {
    _id: { type: String, default: () => newId('meal') },
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    source: { type: String, required: true, enum: ['seed', 'ai'], index: true },
    status: { type: String, required: true, enum: ['draft', 'published'], default: 'draft', index: true },
    cuisines: { type: [String], default: [] },
    difficulty: { type: String, required: true, enum: ['easy', 'medium', 'involved'] },
    cookTimeMinutes: { type: Number, required: true },
    serves: { type: Number, required: true, default: 4 },
    whatMakesItGood: { type: String, default: '' },
    description: { type: String, default: '' },
    ingredients: { type: [mealIngredientSchema], default: [] },
    steps: { type: [mealStepSchema], default: [] },
    ingredientKeys: { type: [String], default: [], index: true },
    heroIcon: { type: String, default: null },
    // No `default`: an absent value means `full`, and writing the default would
    // make a backfill indistinguishable from a deliberate choice.
    quality: { type: String, enum: MEAL_QUALITIES, required: false },
    variantOf: { type: String, default: null, index: true },
    images: { type: [recipeImageSchema], default: [] },
    primaryImageId: { type: String, default: null },
    createdBy: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'meals' },
);

// The console's "needs review" queue is a prefix query, not a collection scan.
mealSchema.index({ 'images.status': 1 });

/**
 * Quality, read safely.
 *
 * Every existing recipe predates the field, so an absent value MUST read as
 * `full` — otherwise a backfill is required before anything works, and a
 * document written outside Mongoose would rank as though it were minimal.
 */
export function qualityOf(meal: Pick<MealAttributes, 'quality'>): MealQuality {
  return meal.quality ?? 'full';
}

export type MealDocument = HydratedDocument<MealAttributes>;
export const MealModel = model<MealAttributes>('Meal', mealSchema);

// ── What a person cooked, and when ──

export interface CookedMealAttributes {
  _id: string;
  ownerId: string;
  mealId: string | null;
  mealName: string;
  cookedAt: Date;
  createdAt: Date;
}

const cookedSchema = new Schema<CookedMealAttributes>(
  {
    _id: { type: String, default: () => newId('meal') },
    ownerId: { type: String, required: true, index: true },
    mealId: { type: String, default: null },
    mealName: { type: String, required: true },
    cookedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'cooked_meals' },
);

cookedSchema.index({ ownerId: 1, cookedAt: -1 });

export type CookedMealDocument = HydratedDocument<CookedMealAttributes>;
export const CookedMealModel = model<CookedMealAttributes>('CookedMeal', cookedSchema);

// ── Favourites ──

export interface FavouriteAttributes {
  _id: string;
  ownerId: string;
  mealId: string;
  createdAt: Date;
}

const favouriteSchema = new Schema<FavouriteAttributes>(
  {
    _id: { type: String, default: () => newId('meal') },
    ownerId: { type: String, required: true, index: true },
    mealId: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'favourites' },
);

// Favouriting twice is the same as once.
favouriteSchema.index({ ownerId: 1, mealId: 1 }, { unique: true });

export type FavouriteDocument = HydratedDocument<FavouriteAttributes>;
export const FavouriteModel = model<FavouriteAttributes>('Favourite', favouriteSchema);
