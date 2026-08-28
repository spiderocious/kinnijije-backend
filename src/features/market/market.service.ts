import { MealModel } from '@features/meals/meals.model.js';
import { StockItemModel, STOCK_SOURCES } from '@features/stock/stock.model.js';
import { stockService } from '@features/stock/stock.service.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { byId, GROUPS, illustrationFor, resolve } from '@shared/catalogue/index.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import { MarketItemModel, type MarketItemDocument } from './market.model.js';
import type { AddMarketItemInput } from './market.schema.js';

export interface MarketItemView {
  id: string;
  catalogue_id: string | null;
  name: string;
  quantity: number;
  unit: string;
  reason: string | null;
  bought: boolean;
  /** Worked out from the name — an unknown item still gets a picture. */
  icon: string;
  group: string;
  /** Rough, from the catalogue. Null when we have no idea. */
  estimated_cost: number | null;
}

export interface MarketListView {
  items: MarketItemView[];
  total_items: number;
  bought_count: number;
  /** Rough total. Explicitly an estimate — never a price anyone will pay. */
  estimated_total: number;
  /** What buying these would unblock. */
  unblocks: { meal_name: string; needs: string[] }[];
}

function toView(doc: MarketItemDocument): MarketItemView {
  const item = doc.catalogueId === null ? undefined : byId(doc.catalogueId);
  const illustration =
    item?.icon !== undefined
      ? { icon: item.icon, group: item.group }
      : item !== undefined
        ? { icon: GROUPS[item.group].icon, group: item.group }
        : illustrationFor(doc.name);

  return {
    id: doc._id,
    catalogue_id: doc.catalogueId,
    name: doc.name,
    quantity: doc.quantity,
    unit: doc.unit,
    reason: doc.reason,
    bought: doc.boughtAt !== null,
    icon: illustration.icon,
    group: illustration.group,
    estimated_cost: item === undefined ? null : Math.round(item.costNgn * doc.quantity),
  };
}

export class MarketService {
  private static instance: MarketService | undefined;

  static getInstance(): MarketService {
    MarketService.instance ??= new MarketService();
    return MarketService.instance;
  }

  async list(ownerId: string): Promise<ServiceResult<MarketListView>> {
    const docs = await MarketItemModel.find({ ownerId }).sort({ boughtAt: 1, createdAt: 1 }).exec();
    const items = docs.map(toView);

    return ok({
      items,
      total_items: items.length,
      bought_count: items.filter((i) => i.bought).length,
      estimated_total: items.reduce((sum, i) => sum + (i.estimated_cost ?? 0), 0),
      unblocks: await this.whatThisUnblocks(ownerId, docs),
    });
  }

  /**
   * Which meals buying these would make cookable.
   *
   * This is what turns a shopping list into a decision: "rice alone is in four
   * of your saved meals" is the difference between a chore and a reason to go.
   */
  private async whatThisUnblocks(
    ownerId: string,
    marketDocs: readonly MarketItemDocument[],
  ): Promise<{ meal_name: string; needs: string[] }[]> {
    try {
      const pending = marketDocs.filter((d) => d.boughtAt === null);
      if (pending.length === 0) return [];

      const [meals, stock] = await Promise.all([
        MealModel.find({ status: 'published' }).exec(),
        StockItemModel.find({ ownerId }).exec(),
      ]);

      const haveIds = new Set(
        stock.flatMap((s) => (s.quantity > 0 && s.catalogueId !== null ? [s.catalogueId] : [])),
      );
      const buyingIds = new Set(
        pending.flatMap((p) => (p.catalogueId !== null ? [p.catalogueId] : [])),
      );

      const unblocked: { meal_name: string; needs: string[] }[] = [];

      for (const meal of meals) {
        const required = meal.ingredients.filter((i) => !i.optional && i.catalogueId !== null);
        const stillMissing = required.filter(
          (i) => i.catalogueId !== null && !haveIds.has(i.catalogueId) && !buyingIds.has(i.catalogueId),
        );
        const suppliedByList = required.filter(
          (i) => i.catalogueId !== null && !haveIds.has(i.catalogueId) && buyingIds.has(i.catalogueId),
        );

        // Only meals this list actually COMPLETES. A meal that would still be
        // missing three things is not unblocked by anything here.
        if (stillMissing.length === 0 && suppliedByList.length > 0) {
          unblocked.push({ meal_name: meal.name, needs: suppliedByList.map((i) => i.name) });
        }
      }

      return unblocked.slice(0, 5);
    } catch (error) {
      // A nice-to-have panel must never take the list down.
      logger.error('unblocks calculation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async add(ownerId: string, input: AddMarketItemInput): Promise<ServiceResult<MarketItemView>> {
    const item = input.catalogue_id !== undefined ? byId(input.catalogue_id) ?? null : resolve(input.name);

    const unit = input.unit ?? item?.defaultUnit ?? 'piece';
    const quantity = input.quantity ?? 1;

    // Adding something already on the list bumps the quantity rather than
    // creating a second row — otherwise the list grows duplicates.
    const existing = await MarketItemModel.findOne({ ownerId, name: input.name })
      .collation({ locale: 'en', strength: 2 })
      .exec();

    if (existing !== null) {
      const updated = await MarketItemModel.findOneAndUpdate(
        { _id: existing._id },
        {
          $inc: { quantity },
          // Re-adding something already ticked puts it back on the list: the
          // person clearly wants more of it.
          $set: { boughtAt: null, movedToStockAt: null },
        },
        { new: true },
      ).exec();
      return ok(toView(updated ?? existing));
    }

    const created = await MarketItemModel.create({
      ownerId,
      catalogueId: item?.id ?? null,
      name: input.name,
      quantity,
      unit,
      reason: input.reason ?? null,
    });

    return ok(toView(created));
  }

  async remove(marketId: string, ownerId: string): Promise<ServiceResult<null>> {
    const result = await MarketItemModel.deleteOne({ _id: marketId, ownerId }).exec();
    if (result.deletedCount === 0) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.market.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(null);
  }

  /**
   * Ticks an item bought — and moves it into the kitchen.
   *
   * This is the loop closing: shopping the list is what refills the pantry, and
   * nobody counts anything.
   *
   * `movedToStockAt` is the guard that matters. Ticking, un-ticking and
   * re-ticking must not add the item to stock three times, so the move happens
   * exactly once per item and is recorded.
   */
  async setBought(
    marketId: string,
    ownerId: string,
    bought: boolean,
  ): Promise<ServiceResult<MarketItemView>> {
    const doc = await MarketItemModel.findOne({ _id: marketId, ownerId }).exec();
    if (doc === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.market.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    if (!bought) {
      // Un-ticking does NOT remove it from stock. They bought it; changing
      // their mind about the tick does not un-buy it, and silently deleting
      // stock would be far worse than a stale tick.
      const updated = await MarketItemModel.findOneAndUpdate(
        { _id: marketId, ownerId },
        { $set: { boughtAt: null } },
        { new: true },
      ).exec();
      return ok(toView(updated ?? doc));
    }

    const alreadyMoved = doc.movedToStockAt !== null;

    const updated = await MarketItemModel.findOneAndUpdate(
      { _id: marketId, ownerId },
      { $set: { boughtAt: new Date(), ...(alreadyMoved ? {} : { movedToStockAt: new Date() }) } },
      { new: true },
    ).exec();

    if (!alreadyMoved) {
      await stockService.add(ownerId, {
        items: [
          {
            ...(doc.catalogueId !== null && { catalogue_id: doc.catalogueId }),
            name: doc.name,
            quantity: doc.quantity,
            unit: doc.unit,
          },
        ],
        source: STOCK_SOURCES.MARKET,
        reference: 'Bought at the market',
      });
      logger.info('market item moved into stock', { user_id: ownerId, name: doc.name });
    }

    return ok(toView(updated ?? doc));
  }

  /** Clears everything already bought — the "done shopping" action. */
  async clearBought(ownerId: string): Promise<ServiceResult<{ removed: number }>> {
    const result = await MarketItemModel.deleteMany({ ownerId, boughtAt: { $ne: null } }).exec();
    return ok({ removed: result.deletedCount });
  }
}

export const marketService = MarketService.getInstance();
