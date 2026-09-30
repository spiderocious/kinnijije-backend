import { MOODS, type DecideCandidate, type DecideInput, type Mood } from './decide.types.js';

/**
 * The words we write ourselves.
 *
 * Used for every promoted meal, and for the winner whenever the model was
 * unavailable, too slow, or returned something that did not parse. It must
 * therefore be good enough to ship on its own — a fallback nobody would want
 * to read is not a fallback.
 *
 * Voice rules, from docs/v2/design.html §07: short beats clever, no
 * exclamation marks, never a greeting, and every claim must be TRUE of the
 * data rather than generically encouraging.
 */

const MOOD_OPENERS: Readonly<Record<Mood, string>> = {
  [MOODS.TIRED]: 'Nothing complicated',
  [MOODS.FAST]: 'Quick',
  [MOODS.PROPER]: 'Worth the effort',
  [MOODS.COMFORT]: 'Familiar and easy',
};

/** "You have 5 of 7" — arithmetic, never a guess. */
export function haveFraction(candidate: DecideCandidate): { have: number; total: number } {
  const total = candidate.have.length + candidate.missing.length;
  return { have: candidate.have.length, total };
}

/**
 * One sentence on why this meal, built only from facts we hold.
 *
 * Deliberately never mentions an ingredient the person did not tap: claiming
 * they have something they do not is the one error that destroys trust in the
 * whole screen.
 */
export function templatedWhy(candidate: DecideCandidate, input: DecideInput): string {
  const { have, total } = haveFraction(candidate);
  const parts: string[] = [];

  parts.push(MOOD_OPENERS[input.mood]);

  if (total > 0 && have === total) {
    parts.push('and you have everything for it');
  } else if (have > 0) {
    const named = candidate.have.slice(0, 2).join(' and ');
    parts.push(`and the ${named} ${candidate.have.length === 1 ? 'is' : 'are'} already in your kitchen`);
  } else if (candidate.missing.length > 0 && candidate.missing.length <= 3) {
    parts.push(`and it is a short list — ${candidate.missing.slice(0, 2).join(', ')} to pick up`);
  }

  const minutes = candidate.meal.cookTimeMinutes;
  const sentence = `${parts.join(' ')}. ${String(minutes)} minutes, start to finish.`;

  // Capitalise once, at the end, so the opener can be reordered freely above.
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** The line above the verdict. Null when there is genuinely nothing to add. */
export function templatedFraming(input: DecideInput, candidate: DecideCandidate | undefined): string | null {
  if (candidate === undefined) return null;
  const minutes = candidate.meal.cookTimeMinutes;
  if (input.mood === MOODS.FAST) return `${String(minutes)} minutes, and you are eating.`;
  if (input.mood === MOODS.TIRED) return 'Short list, short cook.';
  return null;
}

/**
 * The bolded fact on a story card. Always true, always checkable.
 *
 * Ordered by what a person actually decides on: what they already have first,
 * then how far the shop is, then speed.
 */
export function hookLine(candidate: DecideCandidate, fastest: boolean): string {
  const { have, total } = haveFraction(candidate);
  if (total > 0 && have === total) return 'You have everything.';
  if (have > 0) return `You have ${String(have)} of ${String(total)}.`;
  if (candidate.missing.length <= 2) return `Only ${String(candidate.missing.length)} to buy.`;
  if (fastest) return 'Fastest of the three.';
  return `${String(candidate.meal.cookTimeMinutes)} minutes.`;
}
