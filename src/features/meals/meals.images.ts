import { randomBytes } from 'node:crypto';

import { PUBLIC_PREFIX } from '@lib/storage/s3.js';

/**
 * Where a recipe image lives, and what it is called.
 *
 * Derivative names are a CONVENTION, so one stored folder key yields every
 * URL — which is why only the folder is persisted.
 */
export const DERIVATIVE_FILES = ['hero.webp', 'card.webp', 'thumb.webp'] as const;

/**
 * One folder per image, nonce-suffixed.
 *
 * The nonce means a regenerated image is a NEW url, so the year-long immutable
 * cache header never needs purging — nothing is ever overwritten in place.
 */
export function buildRecipeImageKey(slug: string): string {
  const nonce = randomBytes(4).toString('hex');
  return `${PUBLIC_PREFIX}recipes/${slug}-${nonce}`;
}
