import { FileModel } from '@features/files/files.model.js';
import { aiService, ExtractionResultSchema, PhotoVerdictSchema, PROMPT_IDS } from '@lib/ai/index.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import type { JobContext } from '@lib/jobs/jobs.types.js';
import { logger } from '@lib/logger/index.js';
import { presignDownload } from '@lib/storage/s3.js';
import { ALL_UNIT_IDS, resolve } from '@shared/catalogue/index.js';

/**
 * The photo-to-ingredients pipeline, as background jobs.
 *
 * No request ever waits on a model. The API queues a job, answers immediately
 * with its id, and the interface polls or streams until it is done.
 *
 * Two stages, deliberately separate:
 *   1. a CHEAP check that the photo is even food — small fast model
 *   2. the expensive extraction, only on photos that passed
 *
 * Doing it in one call would spend the expensive model on selfies and
 * screenshots.
 */

export const JOB_TYPES = {
  PHOTO_CHECK: 'photo-check',
  PHOTO_EXTRACT: 'photo-extract',
  RECEIPT_EXTRACT: 'receipt-extract',
} as const;

interface ExtractPayload {
  fileIds: string[];
  ownerId: string;
}

/** Fetches an uploaded image as base64 so it can be sent to a model. */
async function fetchImage(fileId: string): Promise<{ base64: string; contentType: string } | null> {
  const file = await FileModel.findById(fileId).exec();
  if (file === null || file.status !== 'ready') return null;

  try {
    const url = await presignDownload(file.key);
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return { base64: buffer.toString('base64'), contentType: file.contentType };
  } catch (error) {
    logger.error('could not fetch image for extraction', {
      file_id: fileId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Stage one: is this even a photo of food?
 *
 * Runs per photo so one bad image does not sink the batch, and reports progress
 * as it goes so the interface can show a real bar rather than a spinner.
 */
async function runPhotoCheck(payload: unknown, ctx: JobContext): Promise<unknown> {
  const { fileIds, ownerId } = payload as ExtractPayload;
  const results: { fileId: string; usable: boolean; verdict: string; reason: string }[] = [];

  for (const [index, fileId] of fileIds.entries()) {
    // Cancellation is cooperative — checked between photos, which is the only
    // safe place to stop.
    if (await ctx.isCancelled()) break;

    await ctx.setProgress(index / fileIds.length, `Checking photo ${String(index + 1)} of ${String(fileIds.length)}`);

    const image = await fetchImage(fileId);
    if (image === null) {
      results.push({ fileId, usable: false, verdict: 'unreadable', reason: 'That upload did not finish.' });
      continue;
    }

    const answer = await aiService.call({
      promptId: PROMPT_IDS.PHOTO_VERDICT,
      schema: PhotoVerdictSchema,
      userPrompt: 'Classify this image.',
      images: [image],
      imageRefs: [fileId],
      ownerId,
      // The cheap model. This question does not need the expensive one.
      tier: 'small',
    });

    if (!answer.ok || answer.data === null) {
      // A failed check is NOT a failed photo — we simply do not know, so we let
      // it through rather than rejecting something that might be fine.
      results.push({ fileId, usable: true, verdict: 'kitchen_scene', reason: 'Could not check this one; trying anyway.' });
      continue;
    }

    results.push({
      fileId,
      usable: answer.data.usable,
      verdict: answer.data.verdict,
      reason: answer.data.reason,
    });
  }

  await ctx.setProgress(1, 'Done checking');
  return { photos: results, usable_count: results.filter((r) => r.usable).length };
}

/**
 * Stage two: read the ingredients.
 *
 * Every item is matched back against the catalogue HERE rather than trusting
 * the model to know our ids — the model returns a name, we resolve it.
 */
function buildExtractHandler(promptId: typeof PROMPT_IDS.INGREDIENTS_FROM_PHOTO | typeof PROMPT_IDS.INGREDIENTS_FROM_RECEIPT) {
  return async (payload: unknown, ctx: JobContext): Promise<unknown> => {
    const { fileIds, ownerId } = payload as ExtractPayload;

    await ctx.setProgress(0.1, 'Loading your photos');

    const images: { base64: string; contentType: string }[] = [];
    for (const fileId of fileIds) {
      const image = await fetchImage(fileId);
      if (image !== null) images.push(image);
    }

    if (images.length === 0) {
      return {
        items: [],
        notes: { errors: ['None of those photos could be opened. Try uploading again.'] },
      };
    }

    if (await ctx.isCancelled()) return { items: [], notes: {} };

    await ctx.setProgress(0.4, 'Reading what is there');

    const answer = await aiService.call({
      promptId,
      schema: ExtractionResultSchema,
      // The allowed units are given IN the prompt so the model picks from our
      // list rather than inventing "packet" or "scoop".
      userPrompt: `Read the food in these ${String(images.length)} image(s).\n\nAllowed unit ids (use one of these or null, never invent one):\n${ALL_UNIT_IDS.join(', ')}`,
      images,
      imageRefs: fileIds,
      ownerId,
      tier: 'large',
    });

    await ctx.setProgress(0.85, 'Matching to ingredients we know');

    // THROW rather than return an empty list. Returning success-with-no-items
    // told the interface everything went fine, so it cleared the photos and
    // showed an empty form — the person lost their uploads AND was told
    // nothing. A failed read is a failed job.
    if (!answer.ok || answer.data === null) {
      throw new Error(
        'We could not read those photos clearly. Try again, or type what you have instead.',
      );
    }

    // Say so plainly when the answer is canned. Presenting mock data as a real
    // read is how somebody ends up trusting a list nothing looked at.
    const mocked = aiService.isMocked;

    // Resolve every read name to a catalogue item on OUR side. The model is
    // never asked for our ids — it would hallucinate them.
    const items = answer.data.items.map((item) => {
      const match = resolve(item.name);
      return {
        catalogue_id: match?.id ?? null,
        name: match?.name ?? item.name,
        raw_name: item.name,
        quantity: item.quantity ?? 1,
        unit: item.unit ?? match?.defaultUnit ?? 'piece',
        confidence: item.confidence,
        /** False when we could not place it — the UI marks it for review. */
        recognised: match !== null,
      };
    });

    await ctx.setProgress(1, 'Ready to review');

    return {
      items,
      notes: mocked
        ? {
            ...answer.data.notes,
            warnings: [
              'AI is switched off, so this is example data rather than a read of your photos.',
              ...(answer.data.notes.warnings ?? []),
            ],
          }
        : answer.data.notes,
    };
  };
}

export function registerExtractionHandlers(): void {
  jobQueue.register(JOB_TYPES.PHOTO_CHECK, runPhotoCheck);
  jobQueue.register(JOB_TYPES.PHOTO_EXTRACT, buildExtractHandler(PROMPT_IDS.INGREDIENTS_FROM_PHOTO));
  jobQueue.register(JOB_TYPES.RECEIPT_EXTRACT, buildExtractHandler(PROMPT_IDS.INGREDIENTS_FROM_RECEIPT));
}
