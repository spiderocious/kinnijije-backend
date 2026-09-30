import { createHash } from 'node:crypto';

import { ALL_GROUPS, CATALOGUE, illustrationFor } from '@shared/catalogue/index.js';

import { MOODS, TIME_BUDGETS, WEIGHTS, type DecideOptionsView } from './decide.types.js';

/**
 * The tiles.
 *
 * Built ONCE at module load from the catalogue, because none of it varies per
 * request — this endpoint is a constant dressed up as a read. That is what
 * makes it free to serve and safe to cache hard at every layer.
 *
 * The WHOLE catalogue is served, not a curated subset. An earlier version
 * capped each group at a handful of items, which meant a cook looking for
 * spaghetti simply could not find it — the item was in the catalogue and
 * invisible in the UI. A search box over 417 items is a solved problem; a
 * missing ingredient is not.
 */

/**
 * The order groups are offered in.
 *
 * Roughly how a cook thinks about their own kitchen: the staple that decides
 * the meal first, then what goes with it, then the things that season it.
 * Anything not named here still appears, after these, so a NEW group can never
 * be silently dropped.
 */
const GROUP_ORDER: readonly string[] = [
  'grain',
  'tuber',
  'pasta_noodle',
  'flour_swallow',
  'legume',
  'vegetable',
  'leafy',
  'meat',
  'poultry',
  'fish',
  'seafood',
  'egg',
  'dairy',
  'oil',
  'spice',
  'seasoning',
  'herb',
  'seed_nut',
  'canned',
  'condiment',
  'fruit',
  'snack',
  'baking',
  'sweetener',
  'drink',
  'other',
];

/**
 * The groups a phone shows before "More groups".
 *
 * A hint for the client, not a filter: every group is sent either way.
 */
export const PRIMARY_GROUP_COUNT = 6;

/**
 * What a Nigerian kitchen actually reaches for first.
 *
 * Offered as its own group at the top, so the common case is one tap rather
 * than a scroll through twenty-six categories. These are ids from the real
 * catalogue, so each still carries its own icon and aliases; an id that stops
 * existing is dropped silently rather than rendering a blank tile.
 */
const POPULAR_IDS: readonly string[] = [
  'rice_long_grain',
  'beans_brown',
  'yam',
  'plantain_ripe',
  'tomato',
  'onion_red',
  'scotch_bonnet',
  'palm_oil',
  'groundnut_oil',
  'egg_chicken',
  'chicken_whole',
  'titus_fish',
  'garri_white',
  'spaghetti',
  'indomie',
  'egusi',
  'ugu',
  'crayfish',
  'beef',
  'goat_meat',
  'semo',
  'stock_cube',
  'salt',
  'dry_pepper',
];

const MOOD_TILES = [
  { id: MOODS.TIRED, label: 'Drained', icon: 'moon', caption: 'Nothing complicated' },
  { id: MOODS.FAST, label: 'In a hurry', icon: 'alarmClock', caption: 'Fast as possible' },
  { id: MOODS.PROPER, label: 'Up for it', icon: 'chefHat', caption: 'Give me a project' },
  { id: MOODS.COMFORT, label: 'Need comfort', icon: 'likeHeart', caption: 'Something familiar' },
  { id: MOODS.SURPRISE, label: "I don't even know", icon: 'shuffle', caption: "I'm so confused rn" },
] as const;

const WEIGHT_TILES = [
  { id: WEIGHTS.SOLID, label: 'Something solid', icon: 'basketRice', caption: 'Rice, yam, plantain' },
  { id: WEIGHTS.LIGHT, label: 'Light', icon: 'seedling', caption: "Won't weigh me down" },
  { id: WEIGHTS.SOUPY, label: 'Soupy', icon: 'potStew', caption: 'Pepper soup, stew' },
  { id: WEIGHTS.SWALLOW, label: 'Swallow', icon: 'bowlSoup', caption: 'Amala, eba, fufu' },
  { id: WEIGHTS.RICE, label: 'Rice', icon: 'plateJollofRice', caption: 'Jollof, fried rice' },
  { id: WEIGHTS.STREET, label: 'Street food', icon: 'cookingPot', caption: 'Suya, akara, boli' },
] as const;

const MINUTE_LABELS: Readonly<Record<number, string>> = {
  15: '15 min',
  40: '40 min',
  90: 'Take my time',
};

/** Typing a city is still allowed; these are the common ones, one tap away. */
const CITIES = ['Lagos', 'Abuja', 'Ibadan', 'Kano', 'Port Harcourt', 'Benin City'] as const;

/** Asserted by a test, so a typo in POPULAR_IDS fails loudly. */
export const POPULAR_ID_COUNT = POPULAR_IDS.length;

/** One catalogue item as a tile. */
function toTile(item: (typeof CATALOGUE)[number]) {
  return {
    id: item.id,
    label: item.name,
    icon: illustrationFor(item.name).icon,
    catalogue_id: item.id,
    // The names a cook actually types. Sent so search can match "atarodo"
    // to scotch bonnet WITHOUT a round-trip per keystroke.
    aliases: item.aliases,
  };
}

/**
 * The Popular group, built from real catalogue rows.
 *
 * Ids that no longer exist are skipped rather than faked, so renaming
 * something in the catalogue can never leave a tile with no icon behind it.
 */
function buildPopular(): DecideOptionsView['kitchen'][number] | null {
  const items = POPULAR_IDS.map((id) => CATALOGUE.find((item) => item.id === id))
    .filter((item): item is (typeof CATALOGUE)[number] => item !== undefined)
    .map(toTile);

  return items.length === 0 ? null : { id: 'popular', label: 'Popular', items };
}

function buildKitchen(): DecideOptionsView['kitchen'] {
  const ordered = [...ALL_GROUPS].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a.id);
    const bi = GROUP_ORDER.indexOf(b.id);
    // An unlisted group sorts last rather than first, so adding one to the
    // catalogue never pushes it to the top of the kitchen screen.
    return (ai === -1 ? GROUP_ORDER.length : ai) - (bi === -1 ? GROUP_ORDER.length : bi);
  });

  const groups = ordered
    .map((group) => ({
      id: group.id,
      label: group.label,
      items: CATALOGUE.filter((item) => item.group === group.id).map(toTile),
    }))
    .filter((group) => group.items.length > 0);

  // Popular leads. Its items also stay in their own groups below: somebody
  // browsing "Grains" should still find rice there.
  const popular = buildPopular();
  return popular === null ? groups : [popular, ...groups];
}

const KITCHEN = buildKitchen();

/**
 * A fingerprint of the payload.
 *
 * Both caches key on this, so editing the catalogue evicts them everywhere at
 * once: a new build produces a new hash, an old cached copy no longer matches,
 * and nobody has to remember to purge anything. A hand-maintained version
 * number is a thing to forget; a hash of the content cannot drift from it.
 */
function fingerprint(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

const BODY = {
  kitchen: KITCHEN,
  primary_group_count: PRIMARY_GROUP_COUNT,
  moods: MOOD_TILES.map((m) => ({ id: m.id, label: m.label, icon: m.icon })),
  weights: WEIGHT_TILES.map((w) => ({ id: w.id, label: w.label, icon: w.icon })),
  minutes: TIME_BUDGETS.map((value) => ({
    value,
    label: MINUTE_LABELS[value] ?? `${String(value)} min`,
  })),
  cities: [...CITIES],
  captions: {
    moods: Object.fromEntries(MOOD_TILES.map((m) => [m.id, m.caption])),
    weights: Object.fromEntries(WEIGHT_TILES.map((w) => [w.id, w.caption])),
  },
};

export const OPTIONS_VERSION = fingerprint(BODY);

/** Total tiles across every group, for the client's "search N ingredients" line. */
export const CATALOGUE_SIZE = KITCHEN.reduce((sum, group) => sum + group.items.length, 0);

const VIEW: DecideOptionsView = { ...BODY, version: OPTIONS_VERSION, total_items: CATALOGUE_SIZE };

export function decideOptions(): DecideOptionsView {
  return VIEW;
}

export const TILE_CAPTIONS = BODY.captions;
