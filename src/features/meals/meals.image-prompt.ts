import type { MealDocument } from './meals.model.js';

/**
 * The photograph prompt, composed from a recipe's own fields.
 *
 * 340 prompts as one function rather than 340 strings. The hard part is not
 * describing the food — it is stopping the model producing a glossy restaurant
 * plate when the product is about home cooking.
 *
 * Full wording and rationale: backend/docs/v2/recipe-photography.md.
 */

/**
 * Bumped whenever the wording below changes, so a sweep can find every image
 * made by an older, worse version.
 */
export const IMAGE_PROMPT_VERSION = 1;

const SHOT = `SHOT
A single serving, photographed from directly overhead or at 45 degrees. Natural
daylight from one side, soft shadows. Shallow depth of field. Resting on a plain
wooden table or a simple laminate surface. Square crop, the food filling most of
the frame.`;

/**
 * The clause that does the most work.
 *
 * Without it every dish arrives fine-dining-plated and the whole product reads
 * as aspirational rather than useful.
 */
const AUTHENTIC = `SERVED AS IT REALLY IS
Served in a real Nigerian home: an ordinary ceramic plate or an enamel bowl. No
garnish that would not actually be there. No styling, no restaurant plating, no
microgreens, no sauce drizzle, no edible flowers, no artful smears. A generous,
ordinary portion — the amount a person would actually eat, not a tasting portion.`;

const NEGATIVE = `MUST NOT APPEAR
No text, no lettering, no watermark, no logo. No hands, no people, no faces. No
cutlery being held. No branded packaging or product labels. No menu card. No
restaurant interior. No artificial steam sprayed for effect. No stock-photo
composition.`;

/**
 * Per-dish corrections, for the dishes models reliably get wrong.
 *
 * The highest-leverage part of this file, and the part that improves through
 * use: each entry is written the first time an operator rejects an image for
 * that specific confusion. Growth here is the feature working.
 *
 * Keyed by slug, matched loosely so "jollof-rice" and "smoky-jollof-rice" both
 * pick up the jollof correction.
 */
export const DISH_HINTS: Readonly<Record<string, string>> = {
  jollof: 'Orange-red rice, coloured by tomato and pepper — NOT yellow, NOT saffron, NOT paella, NOT biryani.',
  egusi: 'A coarse, pale-green melon-seed stew with a lumpy curdled texture — NOT guacamole, NOT pesto, NOT a smooth puree.',
  amala: 'A smooth, very dark brown swallow, matte, shaped into a soft mound — NOT chocolate, NOT mousse, NOT a dessert.',
  ewedu: 'A thin, bright green, slightly viscous soup — NOT a smoothie, NOT a matcha drink.',
  ogbono: 'A dark, noticeably slimy drawn soup that strings when lifted — this texture is correct and must be visible.',
  fufu: 'A plain white or pale cream ball of swallow, smooth and matte — NOT a dumpling, NOT bread, NOT rice.',
  eba: 'A plain pale-cream ball of swallow, smooth and matte — NOT bread, NOT a dumpling.',
  'moi-moi': 'A dense steamed bean pudding, orange-brown, firm enough to hold a wedge shape — NOT cake, NOT frittata.',
  akara: 'Round, deep-fried bean fritters, golden brown and irregular — NOT doughnuts, NOT falafel balls.',
  suya: 'Thin skewered beef crusted in a dry rust-red peanut-and-pepper spice mix — NOT saucy, NOT glazed, NOT satay.',
  'pepper-soup': 'A thin, clear-to-reddish broth with visible pieces of meat or fish — NOT a thick creamy bisque.',
  'efo-riro': 'A dark green leafy stew with visible palm oil and chunks of meat and fish — NOT creamed spinach.',
  dodo: 'Thick slices of ripe plantain, fried to deep gold with dark caramelised edges — NOT banana, NOT chips.',
};

/** The hint for a recipe, matched on its slug. */
export function hintFor(slug: string): string | null {
  const key = slug.toLowerCase();
  for (const [needle, hint] of Object.entries(DISH_HINTS)) {
    if (key.includes(needle)) return hint;
  }
  return null;
}

export function composeImagePrompt(meal: MealDocument): string {
  const keyIngredients = meal.ingredients
    .filter((i) => !i.optional)
    .slice(0, 5)
    .map((i) => i.name);

  const hint = hintFor(meal.slug);

  return [
    `A photograph of ${meal.name}, a Nigerian dish.`,
    keyIngredients.length > 0 ? `Made with ${keyIngredients.join(', ')}.` : '',
    SHOT,
    hint === null ? AUTHENTIC : `${AUTHENTIC}\n${hint}`,
    NEGATIVE,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}
