import { MealModel, type MealDocument } from '@features/meals/meals.model.js';
import { aiService, DecideVerdictSchema, PROMPT_IDS } from '@lib/ai/index.js';
import { logger } from '@lib/logger/index.js';
import { rankingSettings } from '@lib/ranking/index.js';
import { ok, type ServiceResult } from '@lib/service-result.js';

import { templatedFraming } from './decide.copy.js';
import { toMealView } from './decide.presenter.js';
import { POOL_SIZE, rankCandidates, type WeatherHint } from './decide.ranker.js';
import type { DecideCandidate, DecideInput, DecideVerdictView } from './decide.types.js';

/**
 * The anonymous decision.
 *
 * Reads no user, writes nothing, and holds no session: a guest's whole state
 * arrives on the request. See docs/v2/system-design.html §06.
 */

/**
 * How long the model gets before we answer without it.
 *
 * Past it, the deterministic winner is served and marked as such, so the
 * screen can never hang on a model.
 *
 * NINE seconds, not four. At four, a gpt-4o-mini call that genuinely succeeded
 * in ~4.5s lost the race by a few hundred milliseconds: we paid for the tokens,
 * parsed the answer, and then threw it away and showed the templated line. A
 * timeout tighter than the p95 of the thing it guards is not a safety net, it
 * is a guarantee of waste.
 *
 * The client's progress bar is paced to this and no longer promises a number,
 * so raising it costs a slower worst case rather than a broken promise.
 */
export const AI_TIMEOUT_MS = 9_000;

/** How many candidates the model is asked to choose between. */
const CANDIDATES_FOR_MODEL = 3;

export class DecideService {
  private static instance: DecideService | undefined;

  static getInstance(): DecideService {
    DecideService.instance ??= new DecideService();
    return DecideService.instance;
  }

  /**
   * Published meals, for ranking.
   *
   * Lean documents: the ranker reads plain fields and never calls a Mongoose
   * method, and a hydrated document per meal is pure overhead on the hottest
   * path in the product.
   */
  private async publishedMeals(): Promise<MealDocument[]> {
    return (await MealModel.find({ status: 'published' }).lean().exec()) as unknown as MealDocument[];
  }

  async decide(input: DecideInput): Promise<ServiceResult<DecideVerdictView>> {
    const meals = await this.publishedMeals();
    const [weather, config] = await Promise.all([
      this.weatherFor(input.city),
      rankingSettings.current(),
    ]);

    const candidates = rankCandidates(meals, input, { weather, limit: POOL_SIZE, config });

    // Nothing fits. A real answer, not an error — the client widens a filter.
    if (candidates.length === 0) {
      return ok({
        verdict: EMPTY_VERDICT,
        alternates: [],
        pool: [],
        framing: null,
        provenance: 'deterministic',
        notes: {
          summary: 'Nothing matched that combination.',
          warnings: ['Try loosening the time, or adding something from your kitchen.'],
        },
      });
    }

    const views = candidates.map((c) => toMealView(c, input));
    const framed = await this.frame(candidates.slice(0, CANDIDATES_FOR_MODEL), input);

    // The model may promote a different candidate to the top.
    const winnerIndex =
      framed === null ? 0 : candidates.findIndex((c) => c.meal._id === framed.chosenMealId);
    const index = winnerIndex >= 0 ? winnerIndex : 0;

    const verdict = { ...views[index] } as DecideVerdictView['verdict'];
    // Only the winner may carry the model's sentence. Every other meal keeps
    // its templated line — the model wrote about ONE dish, and moving that
    // sentence to another would be a confident lie about their kitchen.
    if (framed !== null && winnerIndex >= 0) verdict.why = framed.why;

    const rest = views.filter((_, i) => i !== index);

    return ok({
      verdict,
      alternates: rest.slice(0, 2),
      pool: rest,
      framing: framed?.framing ?? templatedFraming(input, candidates[index]),
      provenance: framed !== null && winnerIndex >= 0 ? 'ai_framed' : 'deterministic',
    });
  }

  /**
   * The one model call, bounded.
   *
   * Returns null on every failure path — timeout, transport error, unparseable
   * reply, or an id we did not offer. The caller then serves the deterministic
   * winner, so a null here is an ordinary outcome and never an exception.
   */
  private async frame(
    candidates: readonly DecideCandidate[],
    input: DecideInput,
  ): Promise<{ chosenMealId: string; why: string; framing: string | null } | null> {
    if (candidates.length === 0) return null;

    const offered = new Set(candidates.map((c) => c.meal._id));

    const lines = [
      `[[prompt:${PROMPT_IDS.DECIDE_VERDICT}]]`,
      '',
      'THE PERSON:',
      `  mood: ${input.mood}`,
      `  wants: ${input.weight}`,
      `  has about ${String(input.minutes)} minutes`,
      input.city !== undefined && input.city.length > 0 ? `  city: ${input.city}` : '',
      input.kitchenItems.length > 0
        ? `  in their kitchen: ${input.kitchenItems.join(', ')}`
        : '  their kitchen: they said they have nothing',
      '',
      'THE THREE CANDIDATES — you must choose one of these ids:',
      ...candidates.map((c) =>
        [
          `  id: ${c.meal._id}`,
          `    name: ${c.meal.name}`,
          // WITHOUT this the model has no idea what the dish is made of, and
          // writes a sentence about something else entirely: asked to justify
          // Indomie to somebody holding beans and yam, it described a bean and
          // yam porridge and attached the name of a noodle stir-fry.
          `    made with: ${c.meal.ingredients
            .filter((i) => !i.optional)
            .map((i) => i.name)
            .join(', ')}`,
          `    cook time: ${String(c.meal.cookTimeMinutes)} minutes`,
          `    difficulty: ${c.meal.difficulty}`,
          `    they have: ${c.have.length > 0 ? c.have.join(', ') : '(none of it)'}`,
          `    they need: ${c.missing.length > 0 ? c.missing.join(', ') : '(nothing)'}`,
        ].join('\n'),
      ),
      '',
      'Respond with JSON: { chosenMealId, why, framing, notes, metrics }',
    ].filter((line) => line !== '');

    const call = aiService.call({
      promptId: PROMPT_IDS.DECIDE_VERDICT,
      schema: DecideVerdictSchema,
      userPrompt: lines.join('\n'),
      tier: 'small',
    });

    // Race rather than abort: the provider has no cancellation, so the losing
    // call still completes in the background and is simply ignored. Its log row
    // is still written, which is what we want for prompt tuning.
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null);
      }, AI_TIMEOUT_MS).unref();
    });

    const answer = await Promise.race([call, timeout]);

    if (answer === null) {
      logger.warn('decide: model too slow, serving deterministic winner', {
        timeout_ms: AI_TIMEOUT_MS,
      });
      return null;
    }
    if (!answer.ok || answer.data === null) {
      logger.warn('decide: model answer rejected', { error: answer.error });
      return null;
    }

    const data = answer.data as { chosenMealId: string; why: string; framing: string | null };

    // An id we did not send means the reply is discarded WHOLE. Patching it up
    // would mean showing a sentence written about a meal we never offered.
    if (!offered.has(data.chosenMealId)) {
      logger.warn('decide: model chose a meal we did not offer', { chosen: data.chosenMealId });
      return null;
    }

    return data;
  }

  /**
   * Weather, when a city was given.
   *
   * A garnish, never a dependency: any failure returns null and the nudge is
   * skipped silently rather than failing the decision.
   */
  private async weatherFor(city: string | undefined): Promise<WeatherHint | null> {
    if (city === undefined || city.trim().length === 0) return null;

    try {
      const { dayWeather } = await import('@lib/weather/index.js');
      // Already cached for an hour inside the lib, and already null-on-failure,
      // so no extra guarding is needed here beyond the catch.
      const reading = await dayWeather(city, null);
      if (reading === null) return null;
      return { temperature: reading.high, raining: reading.rain };
    } catch (error) {
      logger.debug('decide: weather unavailable, skipping the nudge', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
  }
}

/** Shown when nothing at all matched. Never a real meal. */
const EMPTY_VERDICT: DecideVerdictView['verdict'] = {
  meal_id: '',
  slug: '',
  name: 'Nothing quite fits',
  why: 'Nothing matched that combination of time and taste.',
  cook_time_minutes: 0,
  difficulty: 'easy',
  serves: 0,
  match: { score: 0, have: [], missing: [], low: [], pantry: [] },
  hero_icon: null,
  tags: [],
};

export const decideService = DecideService.getInstance();
