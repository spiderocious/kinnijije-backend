import { MealModel, type MealDocument } from '@features/meals/meals.model.js';
import { aiService, DecideVerdictSchema, PROMPT_IDS } from '@lib/ai/index.js';
import { env } from '@app/env.js';
import { getContext } from '@lib/http/request-context.js';
import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';
import { logger } from '@lib/logger/index.js';
import { rankingSettings } from '@lib/ranking/index.js';
import { ok, type ServiceResult } from '@lib/service-result.js';

import { templatedFraming } from './decide.copy.js';
import { DecideHistoryModel } from './decide-history.model.js';
import { DecideLogModel, hashIp } from './decide-log.model.js';
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

/**
 * The hour in Lagos, 0–23.
 *
 * West Africa Time is UTC+1 with no daylight saving, so this is a fixed offset
 * rather than a timezone database. Every city in the catalogue is Nigerian; if
 * that ever stops being true this becomes a per-city lookup.
 */
function lagosHour(): number {
  return new Date(Date.now() + 60 * 60 * 1000).getUTCHours();
}

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

  /**
   * @param userId set when a session was presented. Their own stock is used
   *   when the client sent no kitchen items, so a signed-in cook is never
   *   asked for something the app already knows.
   */
  async decide(
    input: DecideInput,
    ip = 'unknown',
    userId?: string,
  ): Promise<ServiceResult<DecideVerdictView>> {
    const started = Date.now();
    const placed = await this.withPlace(input);
    const resolved = await this.withKitchenOf(placed.input, userId);
    const meals = await this.publishedMeals();
    const [weather, config] = await Promise.all([
      this.weatherFor(resolved.city),
      rankingSettings.current(),
    ]);

    const candidates = rankCandidates(meals, resolved, {
      weather,
      /**
       * Lagos time, not the server's.
       *
       * Every city we serve is WAT, so a fixed offset is honest and needs no
       * library. Reading the server clock would mean a box in another region
       * recommends breakfast at the wrong hour — and getting this wrong is
       * exactly the "why is it offering me tea at 3pm" complaint.
       */
      hour: lagosHour(),
      limit: POOL_SIZE,
      config,
      orderable: placed.orderable,
    });

    // Nothing fits. A real answer, not an error — the client widens a filter.
    if (candidates.length === 0) {
      this.record(resolved, ip, null, 0, 'deterministic', Date.now() - started, 'no candidates');
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

    const views = candidates.map((c) => toMealView(c, resolved));
    const framed = await this.frame(candidates.slice(0, CANDIDATES_FOR_MODEL), resolved);

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

    this.record(
      resolved,
      ip,
      verdict,
      views.length,
      framed !== null && winnerIndex >= 0 ? 'ai_framed' : 'deterministic',
      Date.now() - started,
      framed === null ? 'model unavailable, slow, or rejected' : null,
    );

    this.remember(resolved, userId, verdict, rest);

    return ok({
      verdict,
      alternates: rest.slice(0, 2),
      pool: rest,
      framing: framed?.framing ?? templatedFraming(resolved, candidates[index]),
      provenance: framed !== null && winnerIndex >= 0 ? 'ai_framed' : 'deterministic',
    });
  }

  /**
   * Fills the kitchen from a signed-in cook's stock, when they sent none.
   *
   * Their STOCK, not their onboarding answers: onboarding is a snapshot from
   * the day they joined, stock is what they have now, and it is what every
   * other screen already trusts.
   *
   * An explicit list always wins — somebody who overrode the pre-fill meant it.
   * A failure falls back to the empty kitchen rather than failing the
   * decision, because a worse suggestion beats no suggestion.
   */
  private async withKitchenOf(input: DecideInput, userId?: string): Promise<DecideInput> {
    // Ordering in: whatever is in the kitchen is beside the point, and letting
    // their stock in would quietly turn this back into a cooking decision.
    if (input.mode === 'order') return { ...input, kitchenItems: [], kitchenSkipped: true };
    if (userId === undefined) return input;
    if (input.kitchenItems.length > 0 || input.kitchenSkipped) return input;

    try {
      const { StockItemModel } = await import('@features/stock/stock.model.js');
      const rows = await StockItemModel.find(
        { ownerId: userId, quantity: { $gt: 0 } },
        { name: 1 },
      )
        .lean()
        .exec();

      if (rows.length === 0) return input;
      return { ...input, kitchenItems: rows.map((r) => r.name) };
    } catch (error) {
      logger.warn('could not read stock for a signed-in decision', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return input;
    }
  }

  /**
   * Resolves the chosen Chowdeck place, if any.
   *
   * Two things come from it, both from OUR tables and never from a live call:
   *   - the city, for weather, when the person did not type one
   *   - in order mode, the meals a cached search already found restaurants for
   *     there, which the ranker nudges up
   *
   * An unknown or hidden place is ignored rather than refused: it only ever
   * steers ranking, and a stale id in somebody's browser must not cost them
   * their answer. Any failure degrades the same way.
   */
  private async withPlace(
    input: DecideInput,
  ): Promise<{ input: DecideInput; orderable: ReadonlySet<string> }> {
    const empty = new Set<string>();
    if (input.placeId === undefined) return { input, orderable: empty };

    try {
      const { chowdeckService } = await import('@features/chowdeck/index.js');
      const { ChowdeckOfferModel } = await import('@features/chowdeck/chowdeck.model.js');

      const place = await chowdeckService.activePlace(input.placeId);
      if (place === null) return { input: { ...input, placeId: undefined }, orderable: empty };

      const withCity =
        (input.city === undefined || input.city.length === 0) && place.city !== null
          ? { ...input, city: place.city }
          : input;

      if (input.mode !== 'order') return { input: withCity, orderable: empty };

      const rows = await ChowdeckOfferModel.find({ placeId: place._id, status: 'ok' }, { query: 1 })
        .lean()
        .exec();
      return {
        input: withCity,
        orderable: new Set(rows.map((r) => r.query.trim().toLowerCase())),
      };
    } catch (error) {
      logger.warn('decide: could not resolve the place, ignoring it', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return { input, orderable: empty };
    }
  }

  /**
   * Records the decision, for the console.
   *
   * Deliberately NOT awaited: a person waiting on a meal must never wait on
   * analytics, and a logging failure must never turn a good decision into an
   * error. The catch is what makes that true rather than aspirational.
   */
  /**
   * The signed-in cook's own copy, for their history.
   *
   * Written to a DIFFERENT collection than `record`, on purpose: `decide_logs`
   * promises in its own header to identify nobody, and attaching an owner to
   * it would retract that for every row. A guest reaches this and writes
   * nothing, which is the whole distinction.
   *
   * Best effort, never awaited. History is a convenience; a failure here must
   * not turn a successful decision into an error the cook sees.
   */
  private remember(
    input: DecideInput,
    userId: string | undefined,
    verdict: DecideVerdictView['verdict'],
    pool: DecideVerdictView['pool'],
  ): void {
    if (userId === undefined) return;

    void DecideHistoryModel.create({
      ownerId: userId,
      kitchenItems: input.kitchenItems,
      kitchenSkipped: input.kitchenSkipped,
      mood: input.mood,
      weight: input.weight,
      minutes: input.minutes,
      city: input.city ?? null,
      mode: input.mode ?? 'cook',
      verdictMealId: verdict.meal_id === '' ? null : verdict.meal_id,
      verdictName: verdict.name,
      verdictScore: verdict.match.score,
      why: verdict.why,
      poolMealIds: pool.map((m) => m.meal_id).filter((id) => id !== ''),
    }).catch((error: unknown) => {
      logger.warn('decide history failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    });
  }

  private record(
    input: DecideInput,
    ip: string,
    verdict: DecideVerdictView['verdict'] | null,
    poolSize: number,
    provenance: string,
    durationMs: number,
    fallbackReason: string | null,
  ): void {
    void DecideLogModel.create({
      requestId: getContext()?.request_id ?? '-',
      // Salted with a server secret the client never sees, so the hash cannot
      // be reversed by walking the IPv4 space.
      ipHash: hashIp(ip, env.JWT_ACCESS_SECRET),
      kitchenItems: input.kitchenItems,
      kitchenSkipped: input.kitchenSkipped,
      mood: input.mood,
      weight: input.weight,
      minutes: input.minutes,
      city: input.city ?? null,
      mode: input.mode ?? 'cook',
      placeId: input.placeId ?? null,
      rejected: input.rejected,
      verdictMealId: verdict?.meal_id === '' ? null : (verdict?.meal_id ?? null),
      verdictName: verdict?.name ?? null,
      verdictScore: verdict?.match.score ?? null,
      poolSize,
      provenance,
      why: verdict?.why ?? null,
      durationMs,
      aiFallbackReason: fallbackReason,
    }).catch((error: unknown) => {
      logger.warn('decide log failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
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
    const ordering = input.mode === 'order';

    const lines = [
      `[[prompt:${PROMPT_IDS.DECIDE_VERDICT}]]`,
      '',
      'THE PERSON:',
      `  mood: ${input.mood}`,
      `  wants: ${input.weight}`,
      // In order mode the clock and the kitchen are not theirs to spend: saying
      // "they have nothing" would have the model apologise for an empty kitchen
      // to somebody who simply does not want to cook.
      ordering
        ? '  they are ORDERING IN tonight, not cooking. Do not mention cooking, cook time, effort or ingredients they have or need.'
        : `  has about ${String(input.minutes)} minutes`,
      input.city !== undefined && input.city.length > 0 ? `  city: ${input.city}` : '',
      ordering
        ? ''
        : input.kitchenItems.length > 0
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
          // What a cook weighs. Left out when ordering, so the model has nothing
          // to be wrong about.
          ...(ordering
            ? []
            : [
                `    cook time: ${String(c.meal.cookTimeMinutes)} minutes`,
                `    difficulty: ${c.meal.difficulty}`,
                `    they have: ${c.have.length > 0 ? c.have.join(', ') : '(none of it)'}`,
                `    they need: ${c.missing.length > 0 ? c.missing.join(', ') : '(nothing)'}`,
              ]),
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
      // The degradation nobody would otherwise see: the person gets a real
      // answer, just the deterministic one, and nothing in the response says so.
      analytics.track(SERVER_EVENTS.AI_FALLBACK_SERVED, 'system', {
        prompt_id: PROMPT_IDS.DECIDE_VERDICT,
        reason: 'timeout',
        timeout_ms: AI_TIMEOUT_MS,
      });
      return null;
    }
    if (!answer.ok || answer.data === null) {
      logger.warn('decide: model answer rejected', { error: answer.error });
      analytics.track(SERVER_EVENTS.AI_FALLBACK_SERVED, 'system', {
        prompt_id: PROMPT_IDS.DECIDE_VERDICT,
        reason: 'answer_rejected',
      });
      return null;
    }

    const data = answer.data as { chosenMealId: string; why: string; framing: string | null };

    // An id we did not send means the reply is discarded WHOLE. Patching it up
    // would mean showing a sentence written about a meal we never offered.
    if (!offered.has(data.chosenMealId)) {
      logger.warn('decide: model chose a meal we did not offer', { chosen: data.chosenMealId });
      // The model inventing a meal we never sent it. Worth an alert, not just a
      // chart — it means the prompt contract is being ignored.
      analytics.track(SERVER_EVENTS.AI_FALLBACK_SERVED, 'system', {
        prompt_id: PROMPT_IDS.DECIDE_VERDICT,
        reason: 'unoffered_meal',
      });
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
