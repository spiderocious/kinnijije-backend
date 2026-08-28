import type { UserDocument } from '@features/users/users.model.js';

export interface KitchenView {
  /** What the cook currently says is in their kitchen. */
  items: string[];
  /** Things used before and not already in the basket — for "pick from recent". */
  recent: string[];
}

/** How many recents the kitchen screen offers. Beyond a handful nobody scans them. */
export const RECENT_SUGGESTION_LIMIT = 8;

/** How many we retain per user. Enough to survive a few sessions of churn. */
export const RECENT_HISTORY_LIMIT = 40;

export const toKitchenView = (doc: UserDocument): KitchenView => {
  const items = doc.kitchenItems ?? [];
  const inBasket = new Set(items.map((item) => item.toLowerCase()));

  return {
    items,
    // Anything already in the basket would be a no-op chip, so it is filtered
    // out rather than shown and ignored.
    recent: (doc.recentIngredients ?? [])
      .filter((name) => !inBasket.has(name.toLowerCase()))
      .slice(0, RECENT_SUGGESTION_LIMIT),
  };
};
