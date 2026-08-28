import { INGREDIENT_GROUPS, STORAGE_KINDS, type IngredientGroup, type StorageKind } from './catalogue.types.js';

export interface GroupDefinition {
  readonly id: IngredientGroup;
  readonly label: string;
  /** Verified against the koboyo set — a name that does not exist renders nothing. */
  readonly icon: string;
  /** Where things in this group usually live, when the item does not say. */
  readonly defaultStorage: StorageKind;
}

/**
 * The picture and the storage guess for anything we do not know individually.
 *
 * This is what makes an unknown ingredient still look like something: a cook
 * types "ponmo", we match it to meat, and it gets a meat icon and a fridge
 * placement without anyone having catalogued it.
 */
export const GROUPS: Readonly<Record<IngredientGroup, GroupDefinition>> = {
  [INGREDIENT_GROUPS.GRAIN]: { id: INGREDIENT_GROUPS.GRAIN, label: 'Grains', icon: 'bagRice', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.TUBER]: { id: INGREDIENT_GROUPS.TUBER, label: 'Tubers', icon: 'basket', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.LEGUME]: { id: INGREDIENT_GROUPS.LEGUME, label: 'Beans and legumes', icon: 'bagBeans', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.VEGETABLE]: { id: INGREDIENT_GROUPS.VEGETABLE, label: 'Vegetables', icon: 'tomato', defaultStorage: STORAGE_KINDS.FRIDGE },
  [INGREDIENT_GROUPS.LEAFY]: { id: INGREDIENT_GROUPS.LEAFY, label: 'Leaves', icon: 'seedling', defaultStorage: STORAGE_KINDS.FRIDGE },
  [INGREDIENT_GROUPS.FRUIT]: { id: INGREDIENT_GROUPS.FRUIT, label: 'Fruit', icon: 'basketPickles', defaultStorage: STORAGE_KINDS.FRIDGE },
  [INGREDIENT_GROUPS.MEAT]: { id: INGREDIENT_GROUPS.MEAT, label: 'Meat', icon: 'potStew', defaultStorage: STORAGE_KINDS.FREEZER },
  [INGREDIENT_GROUPS.POULTRY]: { id: INGREDIENT_GROUPS.POULTRY, label: 'Poultry', icon: 'chickenCoop', defaultStorage: STORAGE_KINDS.FREEZER },
  [INGREDIENT_GROUPS.FISH]: { id: INGREDIENT_GROUPS.FISH, label: 'Fish', icon: 'fisherman', defaultStorage: STORAGE_KINDS.FREEZER },
  [INGREDIENT_GROUPS.SEAFOOD]: { id: INGREDIENT_GROUPS.SEAFOOD, label: 'Seafood', icon: 'fisherman', defaultStorage: STORAGE_KINDS.FREEZER },
  [INGREDIENT_GROUPS.DAIRY]: { id: INGREDIENT_GROUPS.DAIRY, label: 'Dairy', icon: 'milkBottle', defaultStorage: STORAGE_KINDS.FRIDGE },
  [INGREDIENT_GROUPS.EGG]: { id: INGREDIENT_GROUPS.EGG, label: 'Eggs', icon: 'egg', defaultStorage: STORAGE_KINDS.FRIDGE },
  [INGREDIENT_GROUPS.OIL]: { id: INGREDIENT_GROUPS.OIL, label: 'Oils', icon: 'bottleWater', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.SPICE]: { id: INGREDIENT_GROUPS.SPICE, label: 'Spices', icon: 'mortarPestle', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.HERB]: { id: INGREDIENT_GROUPS.HERB, label: 'Herbs', icon: 'seedling', defaultStorage: STORAGE_KINDS.FRIDGE },
  [INGREDIENT_GROUPS.SEASONING]: { id: INGREDIENT_GROUPS.SEASONING, label: 'Seasoning', icon: 'cylinder', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.SEED_NUT]: { id: INGREDIENT_GROUPS.SEED_NUT, label: 'Seeds and nuts', icon: 'bottleAlmonds', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.FLOUR_SWALLOW]: { id: INGREDIENT_GROUPS.FLOUR_SWALLOW, label: 'Flour and swallow', icon: 'wheat', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.PASTA_NOODLE]: { id: INGREDIENT_GROUPS.PASTA_NOODLE, label: 'Pasta and noodles', icon: 'couscousPlate', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.BAKING]: { id: INGREDIENT_GROUPS.BAKING, label: 'Baking', icon: 'whisk', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.SNACK]: { id: INGREDIENT_GROUPS.SNACK, label: 'Snacks', icon: 'loafBread', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.DRINK]: { id: INGREDIENT_GROUPS.DRINK, label: 'Drinks', icon: 'bottleWater', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.CONDIMENT]: { id: INGREDIENT_GROUPS.CONDIMENT, label: 'Condiments', icon: 'bottleWater', defaultStorage: STORAGE_KINDS.FRIDGE },
  [INGREDIENT_GROUPS.CANNED]: { id: INGREDIENT_GROUPS.CANNED, label: 'Tinned', icon: 'cylinder', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.SWEETENER]: { id: INGREDIENT_GROUPS.SWEETENER, label: 'Sweeteners', icon: 'cylinder', defaultStorage: STORAGE_KINDS.SHELF },
  [INGREDIENT_GROUPS.OTHER]: { id: INGREDIENT_GROUPS.OTHER, label: 'Other', icon: 'basket', defaultStorage: STORAGE_KINDS.SHELF },
};

export const ALL_GROUPS: readonly GroupDefinition[] = Object.values(GROUPS);
