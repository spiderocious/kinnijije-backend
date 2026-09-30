import { aiService, PROMPT_IDS, RecipeImageVerdictSchema } from '@lib/ai/index.js';
import { newId } from '@lib/ids.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import type { JobContext } from '@lib/jobs/jobs.types.js';
import { logger } from '@lib/logger/index.js';
import { putPublicObject } from '@lib/storage/s3.js';

import { composeImagePrompt, IMAGE_PROMPT_VERSION } from './meals.image-prompt.js';
import { MealModel, MAX_RECIPE_IMAGES, type MealDocument } from './meals.model.js';
import { buildRecipeImageKey, DERIVATIVE_FILES } from './meals.images.js';

export const RECIPE_IMAGE_JOB_TYPE = 'recipe-image';

export interface RecipeImagePayload {
  mealId: string;
  /** An operator's edited prompt, when they chose to change it. */
  promptOverride?: string | undefined;
  actorId: string;
}

/**
 * Below this, a "not the dish" verdict is confident enough to bin the image
 * without bothering a person. Above it the model is unsure, and an unsure
 * machine should defer rather than discard.
 */
const CONFIDENT_MISS = 0.8;

/**
 * Generates one recipe photograph.
 *
 * Queued rather than done on request for the usual reason plus a sharper one:
 * an image model takes 5-20 seconds, and this endpoint is reachable from a
 * console where somebody is waiting. It also costs real money per call, which
 * is why it is only ever triggered by a deliberate click.
 */
async function runRecipeImage(payload: unknown, ctx: JobContext): Promise<unknown> {
  const { mealId, promptOverride, actorId } = payload as RecipeImagePayload;

  const meal = await MealModel.findById(mealId).exec();
  if (meal === null) return { skipped: true, reason: 'recipe is gone' };

  // Checked here as well as in the console: a queued job can outlive the state
  // it was queued in, and the cap is a spend guard rather than a UI nicety.
  if (meal.images.length >= MAX_RECIPE_IMAGES) {
    return { skipped: true, reason: 'at the image cap' };
  }

  await ctx.setProgress(0.1, 'Writing the shot');
  const prompt = promptOverride ?? composeImagePrompt(meal);

  if (await ctx.isCancelled()) return { cancelled: true };

  await ctx.setProgress(0.3, 'Cooking the picture');
  const generated = await aiService.generateImage({ prompt, ownerId: actorId });
  // Thrown, not returned: a transport failure is exactly what the queue's
  // attempt logic exists to retry.
  if (!generated.ok || generated.data === null) throw new Error(generated.error ?? 'no image');

  await ctx.setProgress(0.6, 'Checking we got the dish');
  const check = await verifyDish(generated.data.bytes, meal, actorId);

  // A confident miss never reaches storage or a person's attention.
  if (check !== null && !check.isDish && check.confidence > CONFIDENT_MISS) {
    logger.info('recipe image discarded before storage', { meal_id: mealId, reason: check.reason });
    return { rejected: true, reason: check.reason };
  }

  if (await ctx.isCancelled()) return { cancelled: true };

  await ctx.setProgress(0.85, 'Putting it away');
  const key = buildRecipeImageKey(meal.slug);
  await storeDerivatives(key, generated.data.bytes, generated.data.contentType);

  meal.images.push({
    _id: newId('recipeImage'),
    key,
    source: 'generated',
    status: 'review',
    blurData: null,
    width: 1024,
    height: 1024,
    bytes: generated.data.bytes.byteLength,
    prompt,
    model: generated.data.model,
    promptVersion: IMAGE_PROMPT_VERSION,
    checkConfidence: check?.confidence ?? null,
    checkReason: check?.reason ?? null,
    jobId: ctx.jobId,
    addedBy: actorId,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: new Date(),
  });

  await meal.save();
  await ctx.setProgress(1, 'Ready for review');

  return { key, confidence: check?.confidence ?? null };
}

/**
 * The cheap vision pass.
 *
 * Returns null when the check itself failed — which must NOT bin the image: a
 * broken checker is our problem, and the human review step still stands behind
 * it.
 */
async function verifyDish(
  bytes: Uint8Array,
  meal: MealDocument,
  actorId: string,
): Promise<{ isDish: boolean; confidence: number; reason: string } | null> {
  const keyIngredients = meal.ingredients
    .filter((i) => !i.optional)
    .slice(0, 5)
    .map((i) => i.name)
    .join(', ');

  const answer = await aiService.call({
    promptId: PROMPT_IDS.IMAGE_VERIFY,
    schema: RecipeImageVerdictSchema,
    userPrompt: [
      `[[prompt:${PROMPT_IDS.IMAGE_VERIFY}]]`,
      '',
      `THE DISH: ${meal.name}`,
      `MADE WITH: ${keyIngredients}`,
      '',
      'Respond with JSON: { isDish, looksHomemade, hasForbidden, confidence, reason, notes, metrics }',
    ].join('\n'),
    images: [{ base64: Buffer.from(bytes).toString('base64'), contentType: 'image/png' }],
    ownerId: actorId,
    tier: 'small',
  });

  if (!answer.ok || answer.data === null) {
    logger.warn('recipe image check failed — deferring to the human review', {
      error: answer.error,
    });
    return null;
  }

  const data = answer.data as { isDish: boolean; confidence: number; reason: string };
  return { isDish: data.isDish, confidence: data.confidence, reason: data.reason };
}

/**
 * Writes the derivatives.
 *
 * TODO(images): hero/card/thumb are currently the SAME bytes. Resizing needs an
 * image library (`sharp`), which is a native dependency and a deliberate
 * decision rather than something to add silently. Until then the keys and the
 * contract are correct, so adding real resizing later changes this function and
 * nothing else — no model change, no API change, no client change.
 */
async function storeDerivatives(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await Promise.all(
    DERIVATIVE_FILES.map((name) =>
      putPublicObject({ key: `${key}/${name}`, body: bytes, contentType }),
    ),
  );
}

export function registerMealHandlers(): void {
  jobQueue.register(RECIPE_IMAGE_JOB_TYPE, runRecipeImage);
}
