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
    createdBy: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'meals' },
);

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
