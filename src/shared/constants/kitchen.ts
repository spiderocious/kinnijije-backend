/**
 * The most ingredient names one request may carry.
 *
 * NOT a product limit. A cook may tick everything they own — the list used to
 * be capped at 40, and a well-stocked kitchen is exactly the one that gets the
 * best answer. This exists only so the public, unauthenticated decide endpoint
 * cannot be handed an endless array: it is set far above the whole ingredient
 * catalogue, so no real kitchen can reach it.
 *
 * One constant for every place a kitchen list is accepted — the decide
 * request, the onboarding save, the stock seed and the parsed "ask" answer —
 * because lifting it in one and not the others just moves the refusal: the
 * list gets through the first call and is rejected by the next.
 */
export const MAX_KITCHEN_NAMES = 1000;
