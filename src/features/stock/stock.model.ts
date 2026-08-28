import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * Where a change to the kitchen came from.
 *
 * The pantry is never stock-taken — it moves as a side-effect of what the cook
 * already does. Recording the source is what makes that claim inspectable: a
 * count that changed for no visible reason is exactly the bug this catches.
 */
export const STOCK_SOURCES = {
  MANUAL: 'manual',
  PHOTO: 'photo',
  RECEIPT: 'receipt',
  MARKET: 'market',
  COOKED: 'cooked',
  ONBOARDING: 'onboarding',
  CORRECTION: 'correction',
} as const;

export type StockSource = (typeof STOCK_SOURCES)[keyof typeof STOCK_SOURCES];

export interface StockItemAttributes {
  _id: string;
  ownerId: string;
  /** Catalogue id when we recognised it; null for a free-typed custom item. */
  catalogueId: string | null;
  /** Always the name the cook sees — their spelling for a custom item. */
  name: string;
  quantity: number;
  unit: string;
  storage: string;
  /** Drives expiry: addedAt + the catalogue's shelf life. */
  addedAt: Date;
  lastMovedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const stockItemSchema = new Schema<StockItemAttributes>(
  {
    _id: { type: String, default: () => newId('stock') },
    ownerId: { type: String, required: true, index: true },
    catalogueId: { type: String, default: null, index: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    storage: { type: String, required: true },
    addedAt: { type: Date, required: true, default: () => new Date() },
    lastMovedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, versionKey: false, collection: 'stock_items' },
);

/**
 * One row per ingredient per person.
 *
 * Without this, buying rice twice creates two rice rows and "how much rice do I
 * have" has no answer. Adding more of something must MERGE, and the index is
 * what guarantees it even under a race.
 *
 * Keyed on the lowercased name so "Rice" and "rice" are the same row.
 */
stockItemSchema.index({ ownerId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
stockItemSchema.index({ ownerId: 1, storage: 1 });

export type StockItemDocument = HydratedDocument<StockItemAttributes>;

export const StockItemModel = model<StockItemAttributes>('StockItem', stockItemSchema);

// ── History ──

export interface StockMovementAttributes {
  _id: string;
  ownerId: string;
  stockItemId: string;
  name: string;
  /** Signed: positive added, negative taken out. */
  delta: number;
  unit: string;
  quantityAfter: number;
  source: StockSource;
  /** What caused it — a meal name, a market list, a file id. */
  reference: string | null;
  createdAt: Date;
}

const stockMovementSchema = new Schema<StockMovementAttributes>(
  {
    _id: { type: String, default: () => newId('move') },
    ownerId: { type: String, required: true, index: true },
    stockItemId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    delta: { type: Number, required: true },
    unit: { type: String, required: true },
    quantityAfter: { type: Number, required: true },
    source: { type: String, required: true, enum: Object.values(STOCK_SOURCES) },
    reference: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'stock_movements' },
);

stockMovementSchema.index({ ownerId: 1, createdAt: -1 });

export type StockMovementDocument = HydratedDocument<StockMovementAttributes>;

export const StockMovementModel = model<StockMovementAttributes>('StockMovement', stockMovementSchema);

// ── Units a person invented ──

export interface CustomUnitAttributes {
  _id: string;
  ownerId: string;
  label: string;
  abbr: string;
  createdAt: Date;
}

const customUnitSchema = new Schema<CustomUnitAttributes>(
  {
    _id: { type: String, default: () => newId('unit') },
    ownerId: { type: String, required: true, index: true },
    label: { type: String, required: true },
    abbr: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'custom_units' },
);

// One person cannot define the same unit twice.
customUnitSchema.index({ ownerId: 1, label: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export type CustomUnitDocument = HydratedDocument<CustomUnitAttributes>;

export const CustomUnitModel = model<CustomUnitAttributes>('CustomUnit', customUnitSchema);
