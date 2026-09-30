import type { MealDocument } from '@features/meals/meals.model.js';
import type { MatchedIngredient } from '@features/meals/meals.matcher.js';

/**
 * The anonymous decision.
 *
 * A guest has no row in the database: their answers arrive whole on every
 * request and are held in their own browser between steps. That is why nothing
 * in this module reads or writes a user — see docs/v2/system-design.html §04.
 */

/** How the day feels. Caps cook time and steers the model's framing. */
export const MOODS = {
  /** Drained — nothing complicated. */
  TIRED: 'tired',
  /** In a hurry — fastest thing that works. */
  FAST: 'fast',
  /** Up for it — an involved cook is welcome. */
  PROPER: 'proper',
  /** Needs comfort — the familiar beats the novel. */
  COMFORT: 'comfort',
  /**
   * No idea — the honest answer, and a common one.
   *
   * Every other mood biases the ranking one way. This one deliberately does
   * NOT: somebody who cannot name what they want has told us nothing about
   * time or effort, and inventing a preference for them is how a recommender
   * starts feeling wrong. It leaves the pool wide and lets the rest of their
   * answers decide.
   */
  SURPRISE: 'surprise',
} as const;
export type Mood = (typeof MOODS)[keyof typeof MOODS];
export const ALL_MOODS: readonly Mood[] = Object.values(MOODS);

/** The shape of the plate. Filters the candidate pool before ranking. */
export const WEIGHTS = {
  SOLID: 'solid',
  LIGHT: 'light',
  SOUPY: 'soupy',
  SWALLOW: 'swallow',
  RICE: 'rice',
  STREET: 'street',
} as const;
export type Weight = (typeof WEIGHTS)[keyof typeof WEIGHTS];
export const ALL_WEIGHTS: readonly Weight[] = Object.values(WEIGHTS);

/**
 * Minutes on hand. Three buckets rather than a free number: a person does not
 * know whether they have 37 or 44 minutes, and a slider implies a precision
 * the ranking cannot use.
 */
export const TIME_BUDGETS = [15, 40, 90] as const;
export type TimeBudget = (typeof TIME_BUDGETS)[number];
export const DEFAULT_TIME_BUDGET: TimeBudget = 40;

/**
 * Cooking it, or having it brought.
 *
 * `order` is the "don't worry, I'll order" answer on the kitchen step. The
 * kitchen and the clock stop mattering — nobody is cooking — so the ranking
 * runs on mood and weight alone, and the verdict leads with restaurants.
 */
export const DECIDE_MODES = ['cook', 'order'] as const;
export type DecideMode = (typeof DECIDE_MODES)[number];

/** What the client sends. Mirrors DecideDraft in the web app. */
export interface DecideInput {
  kitchenItems: string[];
  kitchenSkipped: boolean;
  mood: Mood;
  weight: Weight;
  minutes: TimeBudget;
  city?: string | undefined;
  /** Absent means `cook`, so every older caller keeps its behaviour. */
  mode?: DecideMode | undefined;
  /** A saved Chowdeck place. Required by the client in order mode; optional here. */
  placeId?: string | undefined;
  /** Meals this person has already refused, this session. Filtered out. */
  rejected: string[];
}

/** One ranked candidate, before it is turned into a wire shape. */
export interface DecideCandidate {
  meal: MealDocument;
  /** 0–1 from the deterministic matcher. Never model-derived. */
  score: number;
  /** Ranking score after mood weighting and the weather nudge. */
  rank: number;
  ingredients: MatchedIngredient[];
  have: string[];
  missing: string[];
  low: string[];
  pantry: string[];
}

// ── The wire shapes ──────────────────────────────────────────────────────

export interface DecideMatchView {
  score: number;
  have: string[];
  missing: string[];
  low: string[];
  /**
   * Assumed-present staples the recipe wants: salt, oil, a stock cube.
   *
   * Shown separately so a cook knows what it needs, but deliberately NOT part
   * of `missing` — it is not a shopping list, and counting it as one is what
   * made every meal look unreachable.
   */
  pantry: string[];
}

export interface DecideMealView {
  meal_id: string;
  slug: string;
  name: string;
  /**
   * Why this one. Model-written for the winner when the AI path succeeded,
   * templated otherwise — and ALWAYS templated for a meal promoted locally,
   * because the model's sentence was written about a different dish.
   */
  why: string;
  cook_time_minutes: number;
  difficulty: MealDocument['difficulty'];
  serves: number;
  match: DecideMatchView;
  hero_icon: string | null;
  /** Tags the client re-ranks on without another request. */
  tags: string[];
}

/**
 * Where the words came from.
 *   ai_framed     — a model wrote `why` and `framing`
 *   deterministic — the model was unavailable, slow, or rejected; we templated it
 */
export type DecideProvenance = 'ai_framed' | 'deterministic';

export interface DecideVerdictView {
  verdict: DecideMealView;
  /** The two shown under the winner. */
  alternates: DecideMealView[];
  /**
   * The rest of the shortlist. Sent so "not this" and "change an answer" can
   * re-rank in the browser and cost NOTHING — the model call already happened.
   */
  pool: DecideMealView[];
  framing: string | null;
  provenance: DecideProvenance;
  /** Absent when there is nothing worth saying. */
  notes?: { summary?: string; warnings?: string[] } | undefined;
}

// ── Options, for the tile screens ────────────────────────────────────────

export interface DecideOptionTile {
  id: string;
  label: string;
  /** A koboyo glyph name, resolved from the catalogue. */
  icon: string;
  /** Present on kitchen tiles: the catalogue id, when we know it. */
  catalogue_id?: string | undefined;
  /**
   * The names a cook actually types: "atarodo", "gari", "spag".
   *
   * Sent with the tile so search matches them in the browser, without a
   * round-trip per keystroke on a connection that may not be good.
   */
  aliases?: readonly string[] | undefined;
}

export interface DecideOptionGroup {
  id: string;
  label: string;
  items: DecideOptionTile[];
}

export interface DecideOptionsView {
  /** The WHOLE catalogue, grouped. Not a curated subset — see decide.options.ts. */
  kitchen: DecideOptionGroup[];
  /** How many groups to show before "More groups". A hint, not a filter. */
  primary_group_count: number;
  moods: DecideOptionTile[];
  weights: DecideOptionTile[];
  minutes: Array<{ value: TimeBudget; label: string }>;
  cities: string[];
  captions: {
    moods: Record<string, string>;
    weights: Record<string, string>;
  };
  /**
   * A fingerprint of this payload.
   *
   * Both the browser cache and the HTTP cache key on it, so editing the
   * catalogue evicts them everywhere at once with nothing to purge by hand.
   */
  version: string;
  total_items: number;
}
