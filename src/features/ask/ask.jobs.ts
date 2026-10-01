import { jobQueue } from '@lib/jobs/jobs.queue.js';
import type { JobContext } from '@lib/jobs/jobs.types.js';
import { logger } from '@lib/logger/index.js';
import { transcriptionProvider } from '@lib/ai/transcription.js';
import { deleteObject, readObject } from '@lib/storage/s3.js';

import { askService } from './ask.service.js';
import { ASK_TURN_JOB_TYPE, type AskTurnJobPayload } from './ask.types.js';

/**
 * The work that must not happen on a request.
 *
 * Transcribing thirty seconds of speech takes seconds, and parsing takes more.
 * Doing either inside an HTTP handler means holding a connection open long
 * enough for any proxy in front of us to cut it — and this feature is aimed at
 * people on Nigerian mobile data, where that is the normal case rather than the
 * edge one.
 *
 * So a turn is a row and a job. The client follows it on a stream, and every
 * event the stream sends is also readable from a plain GET, so a browser that
 * cannot hold a connection loses immediacy and nothing else.
 */

/**
 * `ownerId` on the job IS the session id.
 *
 * The queue requires an owner and Ask has guests, so the session plays that
 * part — the same substitution the stream route makes. It is unguessable and
 * it expires, which is what makes it safe to use as one.
 */
async function runAskTurn(payload: AskTurnJobPayload, ctx: JobContext): Promise<{ ok: boolean }> {
  const { sessionId, turnId, audioKey } = payload;
  let rawText = payload.text ?? null;
  let transcribeMs: number | null = null;

  // ── Transcribe, when there is audio ──────────────────────────────────
  if (audioKey !== undefined) {
    await ctx.setProgress(0.15, 'Listening');
    const provider = transcriptionProvider();

    try {
      const audio = await readObject(audioKey);
      const result = await provider.transcribe(audio, 'note.webm', sessionId);
      rawText = result.text;
      transcribeMs = result.durationMs;
    } catch (error) {
      logger.warn('ask transcription failed', {
        session_id: sessionId,
        provider: provider.name,
        error: error instanceof Error ? error.message : 'unknown',
      });
      await askService.settleTurn(sessionId, turnId, {
        failedStage: 'transcribe',
        errorCode: 'transcription_failed',
      });
      // The audio is useless to us now and it is somebody's voice, so it goes
      // whether or not the read succeeded.
      await deleteObject(audioKey);
      return { ok: false };
    }

    // Transcribed means read. Nothing keeps the recording after this point.
    await deleteObject(audioKey);
  }

  if (rawText === null || rawText.trim().length === 0) {
    await askService.settleTurn(sessionId, turnId, {
      failedStage: 'transcribe',
      errorCode: 'nothing_heard',
      transcribeMs,
    });
    return { ok: false };
  }

  /**
   * A follow-up is transcribed and nothing more.
   *
   * The parse prompt extracts the four decide answers, which a question like
   * "can I use chicken instead" does not contain — running it would reject the
   * turn and throw away a perfectly good transcript. The client takes the text
   * from here and sends it to the follow-up endpoint, which has its own prompt.
   */
  if (payload.step === 'follow_up') {
    await askService.settleTurn(sessionId, turnId, { rawText, transcribeMs, parseMs: null });
    await ctx.setProgress(1, 'Done');
    return { ok: true };
  }

  // ── Parse ────────────────────────────────────────────────────────────
  await ctx.setProgress(0.6, 'Working out what you said');
  const parseStarted = Date.now();
  const session = await askService.rawSession(sessionId);
  const parsed = await askService.parse(rawText, session?.ownerId ?? undefined);
  const parseMs = Date.now() - parseStarted;

  /**
   * A rejected parse is NOT a failed turn.
   *
   * The raw text is still shown — somebody who spoke deserves to see that we
   * heard them even when we could not read answers out of it — and the flow
   * simply asks the question normally. Marking this failed would throw away
   * good text because the interpretation was uncertain.
   */
  await askService.settleTurn(sessionId, turnId, {
    rawText,
    parsed,
    transcribeMs,
    parseMs,
  });

  await ctx.setProgress(1, 'Done');
  return { ok: true };
}

export function registerAskHandlers(): void {
  jobQueue.register(ASK_TURN_JOB_TYPE, runAskTurn);
}
