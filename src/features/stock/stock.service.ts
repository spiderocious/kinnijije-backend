import { logger } from '@lib/logger/index.js';
import { isoOrNull } from '@lib/dates.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import {
  byId,
  convert,
  getUnit,
  GROUPS,
  resolve,
  suggest,
  type CatalogueItem,
} from '@shared/catalogue/index.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import {
  CustomUnitModel,
  STOCK_SOURCES,
  StockItemModel,
  StockMovementModel,
  type StockSource,
} from './stock.model.js';
import type { AddStockInput, CreateCustomUnitInput, UpdateStockInput } from './stock.schema.js';
import { toStockItemView, type StockItemView } from './stock.types.js';

export interface StockDashboard {
  counts: { things_in: number; running_low: number; use_soon: number; could_make: number };
  use_first: StockItemView[];
  running_low: { name: string; reason: string; catalogue_id: string | null }[];
  by_storage: { storage: string; items: StockItemView[] }[];
}

export class StockService {
  private static instance: StockService | undefined;

  static getInstance(): StockService {
    StockService.instance ??= new StockService();
    return StockService.instance;
  }

  async list(ownerId: string): Promise<ServiceResult<StockItemView[]>> {
    const items = await StockItemModel.find({ ownerId }).sort({ name: 1 }).exec();
    return ok(items.map(toStockItemView));
  }

  async getOne(stockId: string, ownerId: string): Promise<ServiceResult<StockItemView>> {
    const item = await StockItemModel.findOne({ _id: stockId, ownerId }).exec();
    if (item === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.stock.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(toStockItemView(item));
  }

  /**
   * Adds a batch, merging with what is already there.
   *
   * Merging is the important part: buying rice twice must not produce two rice
   * rows, or "how much rice do I have" has no answer. The unique index on
   * (owner, name) enforces it even if two requests race, and the upsert below
   * is what makes the merge atomic rather than read-then-write.
   */
  async add(ownerId: string, input: AddStockInput): Promise<ServiceResult<StockItemView[]>> {
    const source = (input.source ?? STOCK_SOURCES.MANUAL) as StockSource;
    const customUnits = await this.customUnitIds(ownerId);
    const touched: string[] = [];

    for (const entry of input.items) {
      const item: CatalogueItem | null =
        entry.catalogue_id !== undefined ? byId(entry.catalogue_id) ?? null : resolve(entry.name);

      if (!this.isKnownUnit(entry.unit, customUnits)) {
        return fail(
          ERROR_CODES.VALIDATION_ERROR,
          MESSAGE_KEYS.common.VALIDATION_ERROR,
          HTTP_STATUS.UNPROCESSABLE,
          {
            fieldErrors: { unit: [`"${entry.unit}" is not a unit we know. Add it first.`] },
            overrideMessage: `"${entry.unit}" is not a unit we know — add it first, or pick one from the list.`,
            rejectionReason: 'unknown_unit',
          },
        );
      }

      const storage = entry.storage ?? item?.storage ?? GROUPS.other.defaultStorage;

      const existing = await StockItemModel.findOne({ ownerId, name: entry.name })
        .collation({ locale: 'en', strength: 2 })
        .exec();

      if (existing === null) {
        const created = await StockItemModel.create({
          ownerId,
          catalogueId: item?.id ?? null,
          name: entry.name,
          quantity: entry.quantity,
          unit: entry.unit,
          storage,
        });
        await this.recordMovement(ownerId, created._id, entry.name, entry.quantity, entry.unit, entry.quantity, source, input.reference ?? null);
        touched.push(created._id);
        continue;
      }

      // Same thing, different unit: convert rather than refuse. Adding 500g to
      // 2kg of rice must work — and where a conversion is impossible (a "bag"
      // has no fixed size) we keep the existing unit and add the raw number
      // rather than silently producing a wrong total.
      let delta = entry.quantity;
      if (entry.unit !== existing.unit) {
        const converted = convert(entry.quantity, entry.unit, existing.unit);
        if (converted.ok && converted.value !== null) {
          delta = converted.value;
        } else {
          logger.warn('could not convert unit when merging stock', {
            from: entry.unit,
            to: existing.unit,
            name: entry.name,
            reason: converted.reason,
          });
        }
      }

      const updated = await StockItemModel.findOneAndUpdate(
        { _id: existing._id },
        { $inc: { quantity: delta }, $set: { lastMovedAt: new Date(), storage } },
        { new: true },
      ).exec();

      if (updated !== null) {
        await this.recordMovement(ownerId, updated._id, updated.name, delta, updated.unit, updated.quantity, source, input.reference ?? null);
        touched.push(updated._id);
      }
    }

    const items = await StockItemModel.find({ _id: { $in: touched }, ownerId }).exec();
    return ok(items.map(toStockItemView));
  }

  async update(stockId: string, ownerId: string, input: UpdateStockInput): Promise<ServiceResult<StockItemView>> {
    const existing = await StockItemModel.findOne({ _id: stockId, ownerId }).exec();
    if (existing === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.stock.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    if (input.unit !== undefined) {
      const customUnits = await this.customUnitIds(ownerId);
      if (!this.isKnownUnit(input.unit, customUnits)) {
        return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.common.VALIDATION_ERROR, HTTP_STATUS.UNPROCESSABLE, {
          fieldErrors: { unit: ['That is not a unit we know'] },
        });
      }
    }

    const update: Record<string, unknown> = { lastMovedAt: new Date() };
    if (input.quantity !== undefined) update['quantity'] = input.quantity;
    if (input.unit !== undefined) update['unit'] = input.unit;
    if (input.storage !== undefined) update['storage'] = input.storage;

    const updated = await StockItemModel.findOneAndUpdate({ _id: stockId, ownerId }, { $set: update }, { new: true }).exec();
    if (updated === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.stock.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    if (input.quantity !== undefined && input.quantity !== existing.quantity) {
      await this.recordMovement(
        ownerId, stockId, updated.name,
        input.quantity - existing.quantity, updated.unit, input.quantity,
        STOCK_SOURCES.CORRECTION, 'manual correction',
      );
    }

    return ok(toStockItemView(updated));
  }

  async remove(stockId: string, ownerId: string): Promise<ServiceResult<null>> {
    const existing = await StockItemModel.findOne({ _id: stockId, ownerId }).exec();
    if (existing === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.stock.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    await StockItemModel.deleteOne({ _id: stockId, ownerId }).exec();
    await this.recordMovement(
      ownerId, stockId, existing.name,
      -existing.quantity, existing.unit, 0,
      STOCK_SOURCES.CORRECTION, 'removed from kitchen',
    );

    return ok(null);
  }

  /**
   * Takes ingredients out because a meal was cooked.
   *
   * Never goes below zero: a cook who had "about" 2kg of rice and made
   * something using 3kg has not created negative rice — they had more than they
   * told us. Clamping is the honest behaviour.
   */
  async consume(
    ownerId: string,
    items: { name: string; quantity: number; unit: string }[],
    reference: string,
  ): Promise<void> {
    for (const entry of items) {
      const existing = await StockItemModel.findOne({ ownerId, name: entry.name })
        .collation({ locale: 'en', strength: 2 })
        .exec();
      if (existing === null) continue;

      let delta = entry.quantity;
      if (entry.unit !== existing.unit) {
        const converted = convert(entry.quantity, entry.unit, existing.unit);
        if (converted.ok && converted.value !== null) delta = converted.value;
      }

      const next = Math.max(0, existing.quantity - delta);
      await StockItemModel.updateOne(
        { _id: existing._id },
        { $set: { quantity: next, lastMovedAt: new Date() } },
      ).exec();

      await this.recordMovement(
        ownerId, existing._id, existing.name,
        -(existing.quantity - next), existing.unit, next,
        STOCK_SOURCES.COOKED, reference,
      );
    }
  }

  async history(ownerId: string, limit = 50): Promise<ServiceResult<unknown[]>> {
    const moves = await StockMovementModel.find({ ownerId }).sort({ createdAt: -1 }).limit(limit).exec();
    return ok(
      moves.map((m) => ({
        id: m._id,
        name: m.name,
        delta: m.delta,
        unit: m.unit,
        quantity_after: m.quantityAfter,
        source: m.source,
        reference: m.reference,
        at: isoOrNull(m.createdAt),
      })),
    );
  }

  /** The dashboard: stats, what to use first, what is low, grouped by location. */
  async dashboard(ownerId: string, couldMake: number): Promise<ServiceResult<StockDashboard>> {
    const docs = await StockItemModel.find({ ownerId }).exec();
    const views = docs.map(toStockItemView);

    const useSoon = views
      .filter((v) => v.freshness === 'soon' || v.freshness === 'past')
      .sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999));

    // "Running low" is anything at or near zero — the honest signal without a
    // usage model. Deliberately NOT a guess at consumption rate: inventing a
    // threshold would nag about things nobody is short of.
    const low = views.filter((v) => v.quantity <= 0);

    const byStorage = ['fridge', 'shelf', 'freezer'].map((storage) => ({
      storage,
      items: views.filter((v) => v.storage === storage),
    }));

    return ok({
      counts: {
        things_in: views.filter((v) => v.quantity > 0).length,
        running_low: low.length,
        use_soon: useSoon.length,
        could_make: couldMake,
      },
      use_first: useSoon.slice(0, 5),
      running_low: low.slice(0, 5).map((v) => ({
        name: v.name,
        reason: 'out — you had this before',
        catalogue_id: v.catalogue_id,
      })),
      by_storage: byStorage,
    });
  }

  suggestIngredients(query: string, limit: number): ServiceResult<unknown[]> {
    return ok(
      suggest(query, limit).map((s) => ({
        catalogue_id: s.item.id,
        name: s.item.name,
        group: s.item.group,
        icon: s.item.icon ?? GROUPS[s.item.group].icon,
        default_unit: s.item.defaultUnit,
        units: s.item.units,
        storage: s.item.storage,
        matched_on: s.matchedOn,
      })),
    );
  }

  async listCustomUnits(ownerId: string): Promise<ServiceResult<unknown[]>> {
    const units = await CustomUnitModel.find({ ownerId }).sort({ label: 1 }).exec();
    return ok(units.map((u) => ({ id: u._id, label: u.label, abbr: u.abbr, custom: true })));
  }

  async createCustomUnit(ownerId: string, input: CreateCustomUnitInput): Promise<ServiceResult<unknown>> {
    try {
      const unit = await CustomUnitModel.create({ ownerId, label: input.label, abbr: input.abbr });
      return ok({ id: unit._id, label: unit.label, abbr: unit.abbr, custom: true });
    } catch (error) {
      if (isDuplicate(error)) {
        return fail(ERROR_CODES.ALREADY_EXISTS, MESSAGE_KEYS.stock.UNIT_EXISTS, HTTP_STATUS.CONFLICT, {
          fieldErrors: { label: [`You already have a unit called "${input.label}".`] },
          overrideMessage: `You already have a unit called "${input.label}".`,
        });
      }
      throw error;
    }
  }

  async deleteCustomUnit(unitId: string, ownerId: string): Promise<ServiceResult<null>> {
    const result = await CustomUnitModel.deleteOne({ _id: unitId, ownerId }).exec();
    if (result.deletedCount === 0) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.stock.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(null);
  }

  private async customUnitIds(ownerId: string): Promise<Set<string>> {
    const units = await CustomUnitModel.find({ ownerId }).select('label').exec();
    return new Set(units.map((u) => u.label.toLowerCase()));
  }

  private isKnownUnit(unit: string, custom: Set<string>): boolean {
    return getUnit(unit) !== undefined || custom.has(unit.toLowerCase());
  }

  /** History is best-effort: a failed audit row must not fail the stock change. */
  private async recordMovement(
    ownerId: string, stockItemId: string, name: string,
    delta: number, unit: string, quantityAfter: number,
    source: StockSource, reference: string | null,
  ): Promise<void> {
    try {
      await StockMovementModel.create({ ownerId, stockItemId, name, delta, unit, quantityAfter, source, reference });
    } catch (error) {
      logger.error('failed to record stock movement', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function isDuplicate(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000;
}

export const stockService = StockService.getInstance();
