import { CATALOGUE, CATALOGUE_BY_ID } from './catalogue.data.js';
import type { CatalogueItem, IngredientGroup } from './catalogue.types.js';
import { GROUPS } from './groups.js';

/**
 * Finding the ingredient someone meant.
 *
 * People do not type canonical names. They type "atarodo", "ata rodo", "rodo",
 * "gari", "tomatos" — and a receipt prints whatever the shop's till decided.
 * Matching only on the display name would fail nearly all of that, so every
 * lookup here searches the aliases too.
 */

const normalise = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    // Punctuation and doubled spaces are noise from receipts and fast typing.
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');

/** name + aliases, normalised, built once. */
const SEARCH_INDEX: ReadonlyArray<{ item: CatalogueItem; terms: string[] }> = CATALOGUE.map(
  (item) => ({
    item,
    terms: [item.name, ...item.aliases].map(normalise),
  }),
);

export interface Suggestion {
  readonly item: CatalogueItem;
  /** Higher is better. Only used for ordering, never shown. */
  readonly score: number;
  /** Which spelling matched, so the UI can show "atarodo → Scotch bonnet". */
  readonly matchedOn: string;
}

/**
 * Typeahead.
 *
 * Ranked so the most useful answers come first: an exact match beats a
 * prefix, a prefix beats a word-start, and a word-start beats a match buried
 * mid-string. Without that ordering, typing "rice" surfaces "Roasted
 * groundnut" before "Long-grain rice", which feels broken.
 */
export function suggest(query: string, limit = 8): Suggestion[] {
  const q = normalise(query);
  if (q.length === 0) return [];

  const hits: Suggestion[] = [];

  for (const { item, terms } of SEARCH_INDEX) {
    let best = 0;
    let matchedOn = '';

    for (const term of terms) {
      let score = 0;
      if (term === q) score = 100;
      else if (term.startsWith(q)) score = 80;
      else if (term.includes(` ${q}`)) score = 60;
      else if (term.includes(q)) score = 40;
      // A short query matching a long name is usually incidental.
      else if (q.length >= 4 && q.includes(term)) score = 30;

      if (score > best) {
        best = score;
        matchedOn = term;
      }
    }

    // A canonical name outranks an alias at equal quality, so the primary
    // spelling wins ties.
    if (best > 0) hits.push({ item, score: best, matchedOn });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit);
}

/** The single best match, or null. Used when resolving a receipt or an AI read. */
export function resolve(name: string): CatalogueItem | null {
  return suggest(name, 1)[0]?.item ?? null;
}

export const byId = (id: string): CatalogueItem | undefined => CATALOGUE_BY_ID.get(id);

export interface Illustration {
  readonly icon: string;
  readonly group: IngredientGroup;
  /** False when we fell back to the group's icon rather than the item's own. */
  readonly exact: boolean;
}

/**
 * A picture for anything, catalogued or not.
 *
 * This is why groups exist. A cook types something we have never heard of; we
 * still find the nearest match, take its group, and show that group's icon —
 * so an unknown ingredient looks like an ingredient rather than a blank.
 * Only something with no resemblance at all falls through to "other".
 */
export function illustrationFor(name: string): Illustration {
  const match = resolve(name);

  if (match === null) {
    return { icon: GROUPS.other.icon, group: 'other', exact: false };
  }

  if (match.icon !== undefined) {
    return { icon: match.icon, group: match.group, exact: true };
  }

  return { icon: GROUPS[match.group].icon, group: match.group, exact: false };
}

/** Everything in a group — for browsing by category rather than searching. */
export function itemsInGroup(group: IngredientGroup): CatalogueItem[] {
  return CATALOGUE.filter((item) => item.group === group);
}
