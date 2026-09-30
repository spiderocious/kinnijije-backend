import type { RecipeImage } from '@features/meals/meals.model.js';
import { publicUrlFor } from '@lib/storage/s3.js';
import { isoOrNull } from '@lib/dates.js';

/**
 * The wire shape of a recipe image.
 *
 * Note what is absent from the cook-facing view: the storage key. It is an
 * internal identifier, and publishing it invites a client to construct its own
 * URLs against the bucket. The console view keeps it, because an operator
 * genuinely needs to trace an object.
 */

/** Derivative names are a convention, so one stored key yields every URL. */
export const DERIVATIVES = ['hero', 'card', 'thumb'] as const;
export type Derivative = (typeof DERIVATIVES)[number];

export interface RecipeImageUrls {
  hero_url: string | null;
  card_url: string | null;
  thumb_url: string | null;
}

export function urlsFor(key: string): RecipeImageUrls {
  return {
    hero_url: publicUrlFor(`${key}/hero.webp`),
    card_url: publicUrlFor(`${key}/card.webp`),
    thumb_url: publicUrlFor(`${key}/thumb.webp`),
  };
}

/** What a cook sees. Only ever built from a PUBLISHED image. */
export interface PublicImageView extends RecipeImageUrls {
  blur: string | null;
  /** Drives the grape mark: generated art is labelled, a photograph is not. */
  source: 'upload' | 'generated';
}

export function toPublicImageView(image: RecipeImage): PublicImageView {
  return {
    ...urlsFor(image.key),
    blur: image.blurData,
    source: image.source,
  };
}

/** What the console sees: everything, including the prompt that made it. */
export interface AdminImageView extends RecipeImageUrls {
  id: string;
  key: string;
  source: 'upload' | 'generated';
  status: RecipeImage['status'];
  is_primary: boolean;
  blur: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  prompt: string | null;
  model: string | null;
  prompt_version: number | null;
  check_confidence: number | null;
  check_reason: string | null;
  job_id: string | null;
  added_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string | null;
}

export function toAdminImageView(image: RecipeImage, primaryId: string | null): AdminImageView {
  return {
    id: image._id,
    key: image.key,
    ...urlsFor(image.key),
    source: image.source,
    status: image.status,
    is_primary: primaryId === image._id,
    blur: image.blurData,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    prompt: image.prompt,
    model: image.model,
    prompt_version: image.promptVersion,
    check_confidence: image.checkConfidence,
    check_reason: image.checkReason,
    job_id: image.jobId,
    added_by: image.addedBy,
    reviewed_by: image.reviewedBy,
    reviewed_at: isoOrNull(image.reviewedAt),
    rejection_reason: image.rejectionReason,
    created_at: isoOrNull(image.createdAt),
  };
}
