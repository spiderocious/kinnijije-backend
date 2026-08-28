import { byId, GROUPS, illustrationFor, type CatalogueItem } from '@shared/catalogue/index.js';
import { isoOrNull } from '@lib/dates.js';

import type { StockItemDocument } from './stock.model.js';

export interface StockItemView {
  id: string;
  catalogue_id: string | null;
  name: string;
  quantity: number;
  unit: string;
  storage: string;
  group: string;
  icon: string;
  /** Days until it is likely past its best. Null when it effectively keeps. */
  days_left: number | null;
  /** fresh · soon · past — drives the freshness dot. */
  freshness: 'fresh' | 'soon' | 'past' | 'unknown';
  added_at: string;
  last_moved_at: string;
}

/** Anything inside this window is "use these first". */
export const SOON_THRESHOLD_DAYS = 3;

export function toStockItemView(doc: StockItemDocument): StockItemView {
  const item: CatalogueItem | undefined =
    doc.catalogueId === null ? undefined : byId(doc.catalogueId);

  // A custom item still gets a picture — that is what groups are for.
  const illustration = item?.icon !== undefined
    ? { icon: item.icon, group: item.group }
    : item !== undefined
      ? { icon: GROUPS[item.group].icon, group: item.group }
      : illustrationFor(doc.name);

  const shelfLife = item?.shelfLifeDays ?? null;
  const daysLeft =
    shelfLife === null
      ? null
      : Math.ceil(
          (doc.addedAt.getTime() + shelfLife * 86_400_000 - Date.now()) / 86_400_000,
        );

  return {
    id: doc._id,
    catalogue_id: doc.catalogueId,
    name: doc.name,
    quantity: doc.quantity,
    unit: doc.unit,
    storage: doc.storage,
    group: illustration.group,
    icon: illustration.icon,
    days_left: daysLeft,
    freshness:
      daysLeft === null ? 'unknown' : daysLeft < 0 ? 'past' : daysLeft <= SOON_THRESHOLD_DAYS ? 'soon' : 'fresh',
    added_at: isoOrNull(doc.addedAt),
    last_moved_at: isoOrNull(doc.lastMovedAt),
  };
}
