import { buildRecipeImageKey } from '@features/meals/meals.images.js';
import { MealModel, MAX_RECIPE_IMAGES, type MealDocument, type RecipeImage } from '@features/meals/meals.model.js';
import { newId } from '@lib/ids.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import {
  deletePublicObject,
  isStorageConfigured,
  objectExists,
  presignUpload,
} from '@lib/storage/s3.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import { toAdminImageView, type AdminImageView } from './admin-images.types.js';

/**
 * Recipe imagery, from the console.
 *
 * Two ways in — an operator uploads a photograph, or clicks Generate — and one
 * pipe out. Everything downstream of arrival is identical, which is why there
 * is only one review step and one primary rule to test.
 *
 * Spec: backend/docs/v2/image-pipeline.html.
 */

/** Only what a browser can actually render, and what we can derive from. */
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function extensionFor(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

export class AdminImagesService {
  private static instance: AdminImagesService | undefined;

  static getInstance(): AdminImagesService {
    AdminImagesService.instance ??= new AdminImagesService();
    return AdminImagesService.instance;
  }

  private async findMeal(mealId: string): Promise<MealDocument | null> {
    return MealModel.findById(mealId).exec();
  }

  private views(meal: MealDocument): AdminImageView[] {
    return meal.images.map((image) => toAdminImageView(image, meal.primaryImageId));
  }

  async list(mealId: string): Promise<ServiceResult<{ images: AdminImageView[]; primary_image_id: string | null }>> {
    const meal = await this.findMeal(mealId);
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok({ images: this.views(meal), primary_image_id: meal.primaryImageId });
  }

  /**
   * Step one of an upload: hand out a presigned PUT and record the intent.
   *
   * The row is created `pending` — it exists from the moment a URL is issued,
   * which is what makes "an upload that never finished" visible rather than
   * silently absent. Exactly the lifecycle `features/files` already models.
   */
  async requestUpload(
    mealId: string,
    input: { content_type: string; content_length: number },
    actorId: string,
  ): Promise<ServiceResult<{ image_id: string; url: string; expires_in_seconds: number }>> {
    if (!isStorageConfigured()) {
      return fail(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        MESSAGE_KEYS.files.STORAGE_UNAVAILABLE,
        HTTP_STATUS.UNAVAILABLE,
      );
    }
    if (!ALLOWED_TYPES.has(input.content_type)) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.recipeImages.UNSUPPORTED_TYPE, HTTP_STATUS.UNPROCESSABLE, {
        rejectionReason: 'unsupported_image_type',
      });
    }
    if (input.content_length > MAX_UPLOAD_BYTES) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.recipeImages.TOO_LARGE, HTTP_STATUS.UNPROCESSABLE, {
        rejectionReason: 'image_too_large',
      });
    }

    const meal = await this.findMeal(mealId);
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    if (meal.images.length >= MAX_RECIPE_IMAGES) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.recipeImages.CAP_REACHED, HTTP_STATUS.CONFLICT, {
        rejectionReason: 'image_cap_reached',
      });
    }

    const key = buildRecipeImageKey(meal.slug);
    const imageId = newId('recipeImage');

    // The original lands inside the image's own folder, beside the derivatives
    // that will be written from it.
    const presigned = await presignUpload({
      key: `${key}/original.${extensionFor(input.content_type)}`,
      contentType: input.content_type,
      contentLength: input.content_length,
    });

    meal.images.push({
      _id: imageId,
      key,
      source: 'upload',
      status: 'pending',
      blurData: null,
      width: null,
      height: null,
      bytes: input.content_length,
      prompt: null,
      model: null,
      promptVersion: null,
      checkConfidence: null,
      checkReason: null,
      jobId: null,
      addedBy: actorId,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt: new Date(),
    } satisfies RecipeImage);

    await meal.save();

    return ok({
      image_id: imageId,
      url: presigned.url,
      expires_in_seconds: presigned.expiresInSeconds,
    });
  }

  /**
   * Step two: the bytes are claimed to have landed, so check that they did.
   *
   * The server never observes a direct-to-R2 PUT, so without this a row can
   * claim a file that was never uploaded. Only after HEAD succeeds does the
   * image move to `review`.
   */
  async confirmUpload(
    mealId: string,
    imageId: string,
    contentType: string,
  ): Promise<ServiceResult<AdminImageView>> {
    const meal = await this.findMeal(mealId);
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const image = meal.images.find((i) => i._id === imageId);
    if (image === undefined) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.recipeImages.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const head = await objectExists(`${image.key}/original.${extensionFor(contentType)}`);
    if (!head.exists) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.files.NOT_UPLOADED, HTTP_STATUS.UNPROCESSABLE, {
        rejectionReason: 'bytes_not_found',
      });
    }

    image.status = 'review';
    image.bytes = head.size;
    await meal.save();

    logger.info('recipe image uploaded', { meal_id: mealId, image_id: imageId });
    return ok(toAdminImageView(image, meal.primaryImageId));
  }

  /**
   * Publishes an image.
   *
   * Publishing the FIRST image auto-sets it primary: a published image with no
   * primary pointer would be invisible on every surface, which is not a state
   * worth allowing to exist.
   */
  async publish(mealId: string, imageId: string, actorId: string): Promise<ServiceResult<AdminImageView>> {
    const meal = await this.findMeal(mealId);
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const image = meal.images.find((i) => i._id === imageId);
    if (image === undefined) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.recipeImages.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    if (image.status === 'pending') {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.files.NOT_UPLOADED, HTTP_STATUS.CONFLICT, {
        rejectionReason: 'bytes_not_confirmed',
      });
    }

    image.status = 'published';
    image.reviewedBy = actorId;
    image.reviewedAt = new Date();
    image.rejectionReason = null;

    meal.primaryImageId ??= image._id;

    await meal.save();
    logger.info('recipe image published', { meal_id: mealId, image_id: imageId });
    return ok(toAdminImageView(image, meal.primaryImageId));
  }

  /**
   * Rejects an image, with a reason.
   *
   * The image is KEPT, not deleted: the reason is the raw material for the
   * per-dish hint map, and a deleted row takes its own lesson with it.
   */
  async reject(
    mealId: string,
    imageId: string,
    reason: string,
    actorId: string,
  ): Promise<ServiceResult<AdminImageView>> {
    const meal = await this.findMeal(mealId);
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const image = meal.images.find((i) => i._id === imageId);
    if (image === undefined) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.recipeImages.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    image.status = 'rejected';
    image.rejectionReason = reason;
    image.reviewedBy = actorId;
    image.reviewedAt = new Date();

    // Rejecting the primary must promote a replacement, or the recipe silently
    // loses its imagery everywhere.
    if (meal.primaryImageId === image._id) {
      meal.primaryImageId = nextPublished(meal, image._id);
    }

    await meal.save();
    return ok(toAdminImageView(image, meal.primaryImageId));
  }

  /**
   * Sets which image is THE image.
   *
   * Refuses an unpublished target rather than silently correcting it: the
   * invariant is that the pointer names a published image, and quietly
   * accepting a draft would break every surface that trusts it.
   */
  async setPrimary(mealId: string, imageId: string): Promise<ServiceResult<{ primary_image_id: string }>> {
    const meal = await this.findMeal(mealId);
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const image = meal.images.find((i) => i._id === imageId);
    if (image === undefined) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.recipeImages.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    if (image.status !== 'published') {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.recipeImages.NOT_PUBLISHED, HTTP_STATUS.CONFLICT, {
        rejectionReason: 'image_not_published',
      });
    }

    meal.primaryImageId = image._id;
    await meal.save();
    return ok({ primary_image_id: image._id });
  }

  /** Hard delete, including the objects in the bucket. */
  async remove(mealId: string, imageId: string): Promise<ServiceResult<null>> {
    const meal = await this.findMeal(mealId);
    if (meal === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.meals.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const image = meal.images.find((i) => i._id === imageId);
    if (image === undefined) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.recipeImages.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    meal.images = meal.images.filter((i) => i._id !== imageId);
    if (meal.primaryImageId === imageId) {
      meal.primaryImageId = nextPublished(meal, imageId);
    }
    await meal.save();

    // Best effort: the row is gone either way, and a stranded object is far
    // better than a delete that half-succeeded and left the row behind.
    if (isStorageConfigured()) {
      await Promise.all(
        ['hero.webp', 'card.webp', 'thumb.webp'].map((name) =>
          deletePublicObject(`${image.key}/${name}`).catch(() => undefined),
        ),
      );
    }

    logger.info('recipe image deleted', { meal_id: mealId, image_id: imageId });
    return ok(null);
  }
}

/** The next published image that is not the one being removed, or null. */
function nextPublished(meal: MealDocument, excludingId: string): string | null {
  const replacement = meal.images.find((i) => i._id !== excludingId && i.status === 'published');
  return replacement?._id ?? null;
}

export const adminImagesService = AdminImagesService.getInstance();
