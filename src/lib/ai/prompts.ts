/**
 * Every AI call site has a stable id.
 *
 * The id is the join between a real call and its canned answer: the mock
 * provider looks up `src/features/mock/data/<id>.json`, so a demo is
 * deterministic and repeatable — the same input always produces the same
 * output, with no network and no spend.
 *
 * Ids are contract-ish: renaming one orphans its mock data and its audit
 * history, so treat it like renaming a database column.
 */
export const PROMPT_IDS = {
  /** Read food items off one or more photos of a shelf, fridge or counter. */
  INGREDIENTS_EXTRACT_PHOTO: 'ingredients.extract_photo',
  /** Read a shopping list off a photo of a market receipt. */
  INGREDIENTS_EXTRACT_RECEIPT: 'ingredients.extract_receipt',
  /** Turn a spoken sentence into a list of ingredients. */
  INGREDIENTS_PARSE_VOICE: 'ingredients.parse_voice',
  /** Turn free text into a normalised ingredient list. */
  INGREDIENTS_PARSE_TEXT: 'ingredients.parse_text',
  /** Transcribe an audio note. */
  AUDIO_TRANSCRIBE: 'audio.transcribe',
  /** Write a recipe for ingredients the seed base does not cover. */
  RECIPE_GENERATE: 'recipe.generate',
  /** Answer a question grounded in the user's kitchen. */
  CHAT_ANSWER: 'chat.answer',
} as const;

export type PromptId = (typeof PROMPT_IDS)[keyof typeof PROMPT_IDS];

export const ALL_PROMPT_IDS: readonly PromptId[] = Object.values(PROMPT_IDS);

/**
 * The system prompts.
 *
 * Kept here rather than inline at the callsite so the wording is reviewable in
 * one place — and so a future prompt-editor console screen has something to
 * read and override.
 *
 * The Nigerian/West African bias is deliberate and load-bearing: it is the
 * whole reason this product beats a generic recipe API.
 */
export const SYSTEM_PROMPTS: Readonly<Record<PromptId, string>> = {
  [PROMPT_IDS.INGREDIENTS_EXTRACT_PHOTO]:
    'You identify food items in a photograph of a home kitchen — a shelf, a fridge, or a counter. ' +
    'Assume a Nigerian or West African kitchen unless the image clearly says otherwise, and use the ' +
    'names a cook there would use (atarodo, ugu, egusi, palm oil). List only what you can actually ' +
    'see. Do not guess at what is inside an opaque container. Reply with a JSON array of strings.',

  [PROMPT_IDS.INGREDIENTS_EXTRACT_RECEIPT]:
    'You read a market or supermarket receipt and list the food items on it. Ignore prices, totals, ' +
    'tax lines and non-food items. Normalise abbreviations to the full ingredient name. Reply with a ' +
    'JSON array of strings.',

  [PROMPT_IDS.INGREDIENTS_PARSE_VOICE]:
    'You turn a spoken sentence about a kitchen into a list of ingredients. The speaker may use ' +
    'Nigerian English, Pidgin, Yoruba, Igbo or Hausa food names — keep the name the speaker used. ' +
    'Drop quantities and filler words. Reply with a JSON array of strings.',

  [PROMPT_IDS.INGREDIENTS_PARSE_TEXT]:
    'You turn free text into a clean list of ingredients. Split on commas and conjunctions, drop ' +
    'quantities, and keep Nigerian and West African ingredient names as written. Reply with a JSON ' +
    'array of strings.',

  [PROMPT_IDS.AUDIO_TRANSCRIBE]:
    'Transcribe the audio verbatim. The speaker is likely to be listing food in Nigerian English or ' +
    'Pidgin.',

  [PROMPT_IDS.RECIPE_GENERATE]:
    'You are a Nigerian home cook writing a recipe someone will actually follow tonight. Bias hard ' +
    'toward Nigerian and West African dishes and toward ingredients available in a Nigerian market. ' +
    'Steps must be achievable in a home kitchen and describe doneness by what the cook can see or ' +
    'smell ("until the oil floats"), not only by the clock. Mark every quantity as an estimate. ' +
    'Reply with JSON matching the requested shape.',

  [PROMPT_IDS.CHAT_ANSWER]:
    'You answer questions about cooking, grounded in what the user actually has in their kitchen. ' +
    'Cite what you based the answer on. If you are drawing on general knowledge rather than their ' +
    'kitchen or a tested recipe, say so plainly. If you do not know, say you do not know.',
};
