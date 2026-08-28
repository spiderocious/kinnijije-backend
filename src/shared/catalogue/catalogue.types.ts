import type { UnitId } from './units.js';

/**
 * Groups exist so an item we have never seen can still be pictured. A cook
 * types "ponmo" and even without a dedicated icon we know it is meat, which is
 * enough for an illustration and enough to guess where it is stored.
 */
export const INGREDIENT_GROUPS = {
  GRAIN: 'grain',
  TUBER: 'tuber',
  LEGUME: 'legume',
  VEGETABLE: 'vegetable',
  LEAFY: 'leafy',
  FRUIT: 'fruit',
  MEAT: 'meat',
  POULTRY: 'poultry',
  FISH: 'fish',
  SEAFOOD: 'seafood',
  DAIRY: 'dairy',
  EGG: 'egg',
  OIL: 'oil',
  SPICE: 'spice',
  HERB: 'herb',
  SEASONING: 'seasoning',
  SEED_NUT: 'seed_nut',
  FLOUR_SWALLOW: 'flour_swallow',
  PASTA_NOODLE: 'pasta_noodle',
  BAKING: 'baking',
  SNACK: 'snack',
  DRINK: 'drink',
  CONDIMENT: 'condiment',
  CANNED: 'canned',
  SWEETENER: 'sweetener',
  OTHER: 'other',
} as const;

export type IngredientGroup = (typeof INGREDIENT_GROUPS)[keyof typeof INGREDIENT_GROUPS];

export const STORAGE_KINDS = {
  FRIDGE: 'fridge',
  SHELF: 'shelf',
  FREEZER: 'freezer',
} as const;

export type StorageKind = (typeof STORAGE_KINDS)[keyof typeof STORAGE_KINDS];

export interface CatalogueItem {
  /** Stable machine id. Never shown; renaming one orphans stored stock. */
  readonly id: string;
  /** What we call it by default. */
  readonly name: string;
  /**
   * Other things people call it — Yoruba, Igbo, Hausa, Pidgin, common
   * misspellings, and market names. This is what makes typing "atarodo" or
   * "ata rodo" find the same pepper, and what lets a receipt line be matched.
   */
  readonly aliases: readonly string[];
  readonly group: IngredientGroup;
  /** Item-specific koboyo icon. Falls back to the group's icon when absent. */
  readonly icon?: string;
  readonly defaultUnit: UnitId;
  /** Units offered in the dropdown, beyond the family default. */
  readonly units: readonly UnitId[];
  /** Roughly how long it keeps once bought, in days. Null = effectively forever. */
  readonly shelfLifeDays: number | null;
  /**
   * Rough cost in naira for ONE `defaultUnit`.
   *
   * Placed to make totals work end to end. These are estimates and are meant to
   * be corrected — never presented as a price the cook will actually pay.
   */
  readonly costNgn: number;
  readonly storage: StorageKind;
}
