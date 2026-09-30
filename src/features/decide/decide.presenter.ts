import { templatedWhy } from './decide.copy.js';
import type { DecideCandidate, DecideInput, DecideMealView } from './decide.types.js';

/**
 * Candidate → wire shape.
 *
 * `why` is always templated here. The model's sentence, when there is one, is
 * written over the winner's afterwards by the service — never here, because a
 * promoted meal inheriting a sentence about a DIFFERENT dish would be a
 * confident lie about the person's own kitchen.
 */
export function toMealView(candidate: DecideCandidate, input: DecideInput): DecideMealView {
  const { meal } = candidate;

  return {
    meal_id: meal._id,
    slug: meal.slug,
    name: meal.name,
    why: templatedWhy(candidate, input),
    cook_time_minutes: meal.cookTimeMinutes,
    difficulty: meal.difficulty,
    serves: meal.serves,
    match: {
      // Rounded: two decimals of a heuristic implies a precision it lacks.
      score: Math.round(candidate.score * 100) / 100,
      have: candidate.have,
      missing: candidate.missing,
      low: candidate.low,
      pantry: candidate.pantry,
    },
    hero_icon: meal.heroIcon,
    tags: meal.cuisines,
  };
}
