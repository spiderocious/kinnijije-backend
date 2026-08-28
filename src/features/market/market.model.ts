import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

export interface MarketItemAttributes {
  _id: string;
  ownerId: string;
  catalogueId: string | null;
  name: string;
  quantity: number;
  unit: string;
  /**
   * Why it is on the list — "4 saved meals need it". Shown so a person can
   * decide whether it is worth the trip.
   */
  reason: string | null;
  boughtAt: Date | null;
  /**
   * Guards the ONE thing that must never double-count: ticking an item as
   * bought moves it into stock, and a re-tick must not move it twice.
   */
  movedToStockAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const marketItemSchema = new Schema<MarketItemAttributes>(
  {
    _id: { type: String, default: () => newId('market') },
    ownerId: { type: String, required: true, index: true },
    catalogueId: { type: String, default: null },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1, min: 0 },
    unit: { type: String, required: true },
    reason: { type: String, default: null },
    boughtAt: { type: Date, default: null },
    movedToStockAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'market_items' },
);

// One row per thing per person — adding rice twice bumps the quantity.
marketItemSchema.index({ ownerId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export type MarketItemDocument = HydratedDocument<MarketItemAttributes>;
export const MarketItemModel = model<MarketItemAttributes>('MarketItem', marketItemSchema);
