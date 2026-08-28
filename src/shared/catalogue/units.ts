/**
 * How things are measured.
 *
 * Nigerian kitchens do not measure in grams. Rice is bought by the congo,
 * garri by the derica, palm oil by the bottle — and a product that insists on
 * kilograms is a product that feels foreign to the person using it. So the
 * local measures are first-class here, with conversions to metric rather than
 * the other way round.
 *
 * A **family** is a set of units that can convert between each other. Two units
 * in different families never convert: 3 pieces of plantain is not a weight, and
 * pretending otherwise produces confident nonsense.
 */

export const UNIT_FAMILIES = {
  WEIGHT: 'weight',
  VOLUME: 'volume',
  COUNT: 'count',
  /** Bunches, bundles, heads — sold as a thing, not measured. */
  BUNDLE: 'bundle',
} as const;

export type UnitFamily = (typeof UNIT_FAMILIES)[keyof typeof UNIT_FAMILIES];

export interface UnitDefinition {
  readonly id: string;
  readonly label: string;
  /** Short form for a chip or a row — "kg", "congo". */
  readonly abbr: string;
  readonly family: UnitFamily;
  /**
   * How many BASE units this is worth. Base per family:
   *   weight → gram · volume → millilitre · count → piece · bundle → bundle
   *
   * Null where a unit genuinely has no fixed size — "a bag" of rice is not a
   * defined weight, and inventing one would be a lie the app tells quietly.
   */
  readonly inBase: number | null;
  /** Local measures are surfaced first; metric is there for anyone who wants it. */
  readonly local?: boolean;
}

/**
 * The measures people actually use.
 *
 * The congo/derica/tin chain is the important one. A "congo" is the classic
 * milk-tin measure sold from a heap; a "derica" is the larger tomato-tin
 * measure. Both vary by market and by seller, so these are honest
 * approximations, not standards — which is exactly why quantities from a photo
 * are always shown for correction rather than committed.
 */
export const UNITS: Readonly<Record<string, UnitDefinition>> = {
  // ── Weight ──
  g: { id: 'g', label: 'grams', abbr: 'g', family: UNIT_FAMILIES.WEIGHT, inBase: 1 },
  kg: { id: 'kg', label: 'kilograms', abbr: 'kg', family: UNIT_FAMILIES.WEIGHT, inBase: 1000 },
  // ~333 g. Three congo to the kilo is the rule of thumb every market uses.
  congo: {
    id: 'congo',
    label: 'congo',
    abbr: 'congo',
    family: UNIT_FAMILIES.WEIGHT,
    inBase: 1000 / 3,
    local: true,
  },
  // A tenth of a congo — the smallest measure anyone sells by.
  tin: { id: 'tin', label: 'tin', abbr: 'tin', family: UNIT_FAMILIES.WEIGHT, inBase: 100 / 3, local: true },
  derica: {
    id: 'derica',
    label: 'derica',
    abbr: 'derica',
    family: UNIT_FAMILIES.WEIGHT,
    inBase: 500,
    local: true,
  },
  // "A bag" of rice is 25kg, 50kg, or whatever the seller had. No fixed size.
  bag: { id: 'bag', label: 'bag', abbr: 'bag', family: UNIT_FAMILIES.WEIGHT, inBase: null, local: true },
  // Tomatoes, peppers and garden eggs are genuinely sold by the basket. Size
  // varies wildly by market, so like a bag it has no fixed weight.
  basket: {
    id: 'basket',
    label: 'basket',
    abbr: 'basket',
    family: UNIT_FAMILIES.WEIGHT,
    inBase: null,
    local: true,
  },
  paint_bucket: {
    id: 'paint_bucket',
    label: 'paint bucket',
    abbr: 'bucket',
    family: UNIT_FAMILIES.WEIGHT,
    inBase: 4000,
    local: true,
  },

  // ── Volume ──
  ml: { id: 'ml', label: 'millilitres', abbr: 'ml', family: UNIT_FAMILIES.VOLUME, inBase: 1 },
  l: { id: 'l', label: 'litres', abbr: 'L', family: UNIT_FAMILIES.VOLUME, inBase: 1000 },
  bottle: {
    id: 'bottle',
    label: 'bottle',
    abbr: 'bottle',
    family: UNIT_FAMILIES.VOLUME,
    inBase: 750,
    local: true,
  },
  sachet: {
    id: 'sachet',
    label: 'sachet',
    abbr: 'sachet',
    family: UNIT_FAMILIES.VOLUME,
    inBase: 50,
    local: true,
  },
  cup: { id: 'cup', label: 'cups', abbr: 'cup', family: UNIT_FAMILIES.VOLUME, inBase: 240 },
  tbsp: { id: 'tbsp', label: 'tablespoons', abbr: 'tbsp', family: UNIT_FAMILIES.VOLUME, inBase: 15 },
  tsp: { id: 'tsp', label: 'teaspoons', abbr: 'tsp', family: UNIT_FAMILIES.VOLUME, inBase: 5 },

  // ── Count ──
  piece: { id: 'piece', label: 'pieces', abbr: 'pcs', family: UNIT_FAMILIES.COUNT, inBase: 1 },
  pack: { id: 'pack', label: 'pack', abbr: 'pack', family: UNIT_FAMILIES.COUNT, inBase: null },
  crate: { id: 'crate', label: 'crate', abbr: 'crate', family: UNIT_FAMILIES.COUNT, inBase: 30, local: true },
  dozen: { id: 'dozen', label: 'dozen', abbr: 'dz', family: UNIT_FAMILIES.COUNT, inBase: 12 },

  // ── Bundle ──
  bunch: { id: 'bunch', label: 'bunch', abbr: 'bunch', family: UNIT_FAMILIES.BUNDLE, inBase: 1 },
  bundle: { id: 'bundle', label: 'bundle', abbr: 'bundle', family: UNIT_FAMILIES.BUNDLE, inBase: 1 },
  handful: {
    id: 'handful',
    label: 'handful',
    abbr: 'handful',
    family: UNIT_FAMILIES.BUNDLE,
    inBase: 1,
    local: true,
  },
  wrap: { id: 'wrap', label: 'wrap', abbr: 'wrap', family: UNIT_FAMILIES.BUNDLE, inBase: 1, local: true },
};

export type UnitId = keyof typeof UNITS;

export const ALL_UNIT_IDS: readonly string[] = Object.keys(UNITS);

export const getUnit = (id: string): UnitDefinition | undefined => UNITS[id];

/** The units a given unit can be swapped for — same family, and convertible. */
export function alternativesFor(unitId: string): UnitDefinition[] {
  const unit = UNITS[unitId];
  if (unit === undefined) return [];
  return Object.values(UNITS).filter((candidate) => candidate.family === unit.family);
}

export interface ConversionResult {
  readonly ok: boolean;
  readonly value: number | null;
  /** Why a conversion could not be done. Shown to nobody; used to decide fallbacks. */
  readonly reason?: 'unknown_unit' | 'different_family' | 'no_fixed_size';
}

/**
 * Converts between two units of the same family.
 *
 * Refuses rather than guesses. A unit with no fixed size ("a bag") cannot be
 * converted, and crossing families is a bug in the caller — returning a
 * plausible number in either case would corrupt every total downstream.
 */
export function convert(value: number, fromId: string, toId: string): ConversionResult {
  const from = UNITS[fromId];
  const to = UNITS[toId];

  if (from === undefined || to === undefined) return { ok: false, value: null, reason: 'unknown_unit' };
  if (from.family !== to.family) return { ok: false, value: null, reason: 'different_family' };
  if (from.inBase === null || to.inBase === null) {
    return { ok: false, value: null, reason: 'no_fixed_size' };
  }

  return { ok: true, value: (value * from.inBase) / to.inBase };
}

/** "2 congo" · "1.5 kg" · "3 pcs" — trailing zeros trimmed. */
export function formatQuantity(value: number, unitId: string): string {
  const unit = UNITS[unitId];
  const rounded = Math.round(value * 100) / 100;
  const shown = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '');
  return unit === undefined ? shown : `${shown} ${unit.abbr}`;
}
