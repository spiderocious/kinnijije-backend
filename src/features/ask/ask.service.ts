import { randomUUID } from 'node:crypto';

import { aiService } from '@lib/ai/index.js';
import { AskFollowUpSchema, AskParseSchema, type AskFollowUp, type AskParse } from '@lib/ai/ai.contracts.js';
import { PROMPT_IDS } from '@lib/ai/prompts.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import { logger } from '@lib/logger/index.js';
import { ok, fail, type ServiceResult } from '@lib/service-result.js';
import { buildObjectKey, isStorageConfigured, presignUpload } from '@lib/storage/s3.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import { hashIp } from '@features/decide/decide-log.model.js';
import { env } from '../../env.js';

import { AskSessionModel, type AskSessionDocument, type AskTurnRecord } from './ask.model.js';
import { ASK_TURN_JOB_TYPE } from './ask.types.js';

/**
 * The Ask conversation.
 *
 * NOTHING HERE BLOCKS ON A MODEL. Creating a turn writes a row and returns an
 * id; the transcription and the parse happen in a job, and the client follows
 * them on a stream. A request that waits four seconds for Whisper is a request
 * that dies to the first proxy timeout, and this feature is meant for people on
 * Nigerian mobile data.
 *
 * It also never touches the decide flow. Ask fills the SAME `POST /decide`
 * payload by a different route — it does not re-rank, re-rank differently, or
 * change what a verdict means.
 */

/** 30 seconds of opus is about 60KB. A megabyte is generous and still bounded. */
const MAX_AUDIO_BYTES = 1_000_000;

const ALLOWED_AUDIO = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/webm;codecs=opus'
]);

/** Below this the parse is thrown away and the question asked normally. */
const MIN_CONFIDENCE = 0.5;

/**
 * How many follow-ups one conversation may spend.
 *
 * Enforced HERE, not in the UI. This endpoint costs money at OpenAI on a public
 * route, so a cap that only hides a button is not a cap — it is a suggestion to
 * anybody holding curl.
 *
 * A signed-in cook gets double: they are a known account that can be suspended,
 * which a guest is not.
 */
const FOLLOW_UP_LIMIT = { guest: 5, member: 10 } as const;

export interface AskTurnView {
  id: string;
  status: AskTurnRecord['status'];
  step: string;
  source: AskTurnRecord['source'];
  raw_text: string | null;
  notes: string[];
  confidence: number | null;
  answers: {
    kitchen_items: string[];
    mood: string | null;
    weight: string | null;
    minutes: number | null;
  } | null;
  unmatched: string[];
  failed_stage: string | null;
  error_code: string | null;
}

export interface AskSessionView {
  id: string;
  carried_notes: string[];
  turns: AskTurnView[];
}

function toTurnView(turn: AskTurnRecord): AskTurnView {
  return {
    id: turn._id,
    status: turn.status,
    step: turn.step,
    source: turn.source,
    raw_text: turn.rawText,
    notes: turn.notes,
    confidence: turn.confidence,
    answers:
      turn.answers === null
        ? null
        : {
            kitchen_items: turn.answers.kitchenItems,
            mood: turn.answers.mood,
            weight: turn.answers.weight,
            minutes: turn.answers.minutes,
          },
    unmatched: turn.unmatched,
    failed_stage: turn.failedStage,
    error_code: turn.errorCode,
  };
}

export class AskService {
  private static instance: AskService | undefined;

  static getInstance(): AskService {
    AskService.instance ??= new AskService();
    return AskService.instance;
  }

  /**
   * Starts a conversation.
   *
   * The returned id IS the caller's identity for everything that follows, which
   * is why it is a ULID rather than anything guessable or sequential.
   */
  async startSession(ip: string, ownerId?: string): Promise<ServiceResult<AskSessionView>> {
    const session = await AskSessionModel.create({
      ownerId: ownerId ?? null,
      ipHash: hashIp(ip, env.JWT_ACCESS_SECRET),
    });

    return ok({ id: session._id, carried_notes: [], turns: [] });
  }

  /**
   * One conversation, scoped to its own id.
   *
   * The id is the only credential, so a caller that does not hold it gets a
   * 404 rather than a 403 — a 403 would confirm the session exists.
   */
  async getSession(sessionId: string): Promise<ServiceResult<AskSessionView>> {
    const session = await AskSessionModel.findById(sessionId).exec();
    if (session === null) return this.noSession();

    return ok({
      id: session._id,
      carried_notes: session.carriedNotes,
      turns: session.turns.map(toTurnView),
    });
  }

  /**
   * A presigned PUT for one voice note.
   *
   * Direct to storage: a 30-second clip on a bad connection must not occupy a
   * node process, and audio has no reason to pass through the API at all. The
   * key is scoped to the session so one conversation cannot write into another.
   */
  async uploadTicket(
    sessionId: string,
    input: { content_type: string; size: number },
  ): Promise<ServiceResult<{ key: string; url: string; expires_in_seconds: number }>> {
    if (!isStorageConfigured()) {
      return fail(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        MESSAGE_KEYS.files.STORAGE_UNAVAILABLE,
        HTTP_STATUS.UNAVAILABLE,
        { rejectionReason: 'storage_not_configured' },
      );
    }
    if (!ALLOWED_AUDIO.has(input.content_type)) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.ask.BAD_AUDIO, HTTP_STATUS.BAD_REQUEST, {
        rejectionReason: 'unsupported_audio_type',
      });
    }
    if (input.size > MAX_AUDIO_BYTES) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.ask.AUDIO_TOO_BIG, HTTP_STATUS.BAD_REQUEST, {
        rejectionReason: 'audio_too_large',
      });
    }

    const session = await AskSessionModel.findById(sessionId).exec();
    if (session === null) return this.noSession();

    const key = buildObjectKey({
      purpose: 'ask',
      ownerId: session._id,
      filename: `${randomUUID()}.webm`,
    });

    // The length is signed in, so the ticket cannot be reused to upload
    // something larger than it declared.
    const { url, expiresInSeconds } = await presignUpload({
      key,
      contentType: input.content_type,
      contentLength: input.size,
    });

    return ok({ key, url, expires_in_seconds: expiresInSeconds });
  }

  /**
   * Records an answer and, when there is something to read, queues the work.
   *
   * Returns as soon as the row exists. A tap settles immediately because there
   * is nothing to interpret; text and voice come back `pending` and finish on
   * the stream.
   */
  async createTurn(
    sessionId: string,
    input: {
      step: string;
      source: AskTurnRecord['source'];
      text?: string | undefined;
      audio_key?: string | undefined;
    },
  ): Promise<ServiceResult<AskTurnView>> {
    const session = await AskSessionModel.findById(sessionId).exec();
    if (session === null) return this.noSession();

    const immediate = input.source === 'tap';
    const turn = {
      step: input.step,
      source: input.source,
      rawText: input.text ?? null,
      audioKey: input.audio_key ?? null,
      notes: [],
      confidence: null,
      status: immediate ? ('done' as const) : ('pending' as const),
      failedStage: null,
      errorCode: null,
      transcribeMs: null,
      parseMs: null,
    };

    // Mongoose fills `_id`, `answers`, `unmatched` and `createdAt` from the
    // schema defaults, so the pushed literal is deliberately partial.
    session.turns.push(turn as unknown as AskTurnRecord);
    await session.save();

    const created = session.turns[session.turns.length - 1];
    if (created === undefined) {
      return fail(ERROR_CODES.INTERNAL, MESSAGE_KEYS.common.INTERNAL, HTTP_STATUS.INTERNAL);
    }

    // Queued, not awaited. The handler is registered at boot; the client picks
    // the result up on the stream. This is the line that keeps a model call off
    // the request path.
    if (!immediate) {
      await jobQueue.enqueue({
        type: ASK_TURN_JOB_TYPE,
        // The session plays the part of an owner — see ask.jobs.ts.
        ownerId: session._id,
        payload: {
          sessionId: session._id,
          turnId: created._id,
          // The job reads this to decide whether to parse at all.
          step: input.step,
          ...(input.audio_key !== undefined && { audioKey: input.audio_key }),
          ...(input.text !== undefined && { text: input.text }),
        },
      });
    }

    return ok(toTurnView(created));
  }

  /** One turn, scoped to its session for the same reason `getSession` is. */
  async getTurn(sessionId: string, turnId: string): Promise<ServiceResult<AskTurnView>> {
    const session = await AskSessionModel.findById(sessionId).exec();
    if (session === null) return this.noSession();

    const turn = session.turns.find((t) => t._id === turnId);
    if (turn === undefined) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.ask.TURN_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(toTurnView(turn));
  }

  /**
   * Turns a sentence into answers, and keeps everything that is not one.
   *
   * Called by the job, never by a request. Low confidence is discarded rather
   * than used: we ask the question normally, which costs one tap, while a bad
   * fill costs somebody finding and undoing four wrong answers.
   */
  async parse(text: string, ownerId?: string): Promise<AskParse | null> {
    const result = await aiService.call({
      promptId: PROMPT_IDS.ASK_PARSE,
      schema: AskParseSchema,
      userPrompt: text,
      tier: 'small',
      ...(ownerId !== undefined && { ownerId }),
    });

    if (!result.ok || result.data === null) {
      logger.warn('ask parse rejected', { error: result.error });
      return null;
    }
    if (result.data.confidence < MIN_CONFIDENCE) {
      logger.info('ask parse below confidence floor', { confidence: result.data.confidence });
      return null;
    }
    return result.data;
  }

  /** Writes what the job worked out back onto the turn. */
  async settleTurn(
    sessionId: string,
    turnId: string,
    outcome: {
      rawText?: string | null;
      parsed?: AskParse | null;
      transcribeMs?: number | null;
      parseMs?: number | null;
      failedStage?: string | null;
      errorCode?: string | null;
    },
  ): Promise<AskTurnView | null> {
    const session = await AskSessionModel.findById(sessionId).exec();
    if (session === null) return null;

    const turn = session.turns.find((t) => t._id === turnId);
    if (turn === undefined) return null;

    if (outcome.rawText !== undefined) turn.rawText = outcome.rawText;
    if (outcome.transcribeMs !== undefined) turn.transcribeMs = outcome.transcribeMs;
    if (outcome.parseMs !== undefined) turn.parseMs = outcome.parseMs;

    if (outcome.failedStage !== undefined && outcome.failedStage !== null) {
      turn.status = 'failed';
      turn.failedStage = outcome.failedStage;
      turn.errorCode = outcome.errorCode ?? 'unknown_error';
    } else {
      turn.status = 'done';
      const parsed = outcome.parsed ?? null;
      if (parsed !== null) {
        turn.notes = parsed.constraints;
        turn.confidence = parsed.confidence;
        turn.unmatched = parsed.unmatched;
        turn.answers = {
          kitchenItems: parsed.kitchenItems,
          mood: parsed.mood,
          weight: parsed.weight,
          minutes: parsed.minutes,
        };

        // Carried across the whole session, so "no pepper" said at step one
        // still applies at step four. De-duplicated case-insensitively: the
        // model repeats itself when somebody does.
        const seen = new Set(session.carriedNotes.map((n) => n.toLowerCase()));
        for (const note of parsed.constraints) {
          if (!seen.has(note.toLowerCase())) {
            session.carriedNotes.push(note);
            seen.add(note.toLowerCase());
          }
        }
      }
    }

    // The audio is gone the moment it has been read. Only the text is kept.
    turn.audioKey = null;
    await session.save();
    return toTurnView(turn);
  }

  /** Marks the session finished, for the funnel. */
  async completeSession(sessionId: string, mealId: string | null): Promise<void> {
    await AskSessionModel.findByIdAndUpdate(sessionId, {
      $set: { verdictMealId: mealId, completedAt: new Date() },
    }).exec();
  }

  /**
   * Talking back to a verdict.
   *
   * The model may only swap to a meal from the shortlist it was given — that is
   * checked against `allowedMealIds` after the reply parses, so a hallucinated
   * id becomes a plain reply rather than a meal nobody has.
   */
  async followUp(
    sessionId: string,
    input: { question: string; allowedMealIds: string[]; context: string },
  ): Promise<
    ServiceResult<{
      id: string;
      action: AskFollowUp['action'];
      text: string;
      meal_id: string | null;
      refused: boolean;
      remaining: number;
    }>
  > {
    const session = await AskSessionModel.findById(sessionId).exec();
    if (session === null) return this.noSession();

    const limit = session.ownerId === null ? FOLLOW_UP_LIMIT.guest : FOLLOW_UP_LIMIT.member;
    if (session.followUps.length >= limit) {
      return fail(
        ERROR_CODES.RATE_LIMITED,
        MESSAGE_KEYS.ask.FOLLOW_UP_LIMIT,
        HTTP_STATUS.TOO_MANY_REQUESTS,
        { rejectionReason: 'follow_up_limit_reached' },
      );
    }

    const result = await aiService.call({
      promptId: PROMPT_IDS.ASK_FOLLOW_UP,
      schema: AskFollowUpSchema,
      userPrompt: `${input.context}\n\nTHEY SAID: ${input.question}`,
      tier: 'small',
      ...(session.ownerId !== null && { ownerId: session.ownerId }),
    });

    if (!result.ok || result.data === null) {
      logger.warn('ask follow-up rejected', { error: result.error });
      return fail(
        ERROR_CODES.UPSTREAM_FAILURE,
        MESSAGE_KEYS.ask.FOLLOW_UP_FAILED,
        HTTP_STATUS.UNAVAILABLE,
      );
    }

    const answer = result.data;

    /**
     * The grounding check the schema cannot do.
     *
     * A swap to an id we never offered is a hallucination, and acting on it
     * would put a meal on screen that is not in the pool. Downgraded to a plain
     * reply rather than failed: the sentence is usually still fine.
     */
    const allowed = new Set(input.allowedMealIds);
    const mealId =
      answer.action === 'swap' && answer.mealId !== null && allowed.has(answer.mealId)
        ? answer.mealId
        : null;
    const action: AskFollowUp['action'] =
      answer.action === 'swap' && mealId === null ? 'reply' : answer.action;

    session.followUps.push({
      question: input.question,
      answer: answer.text,
      mealId,
      refused: answer.refused,
    } as never);
    await session.save();

    const created = session.followUps[session.followUps.length - 1];
    return ok({
      id: created?._id ?? '',
      action,
      text: answer.text,
      meal_id: mealId,
      refused: answer.refused,
      remaining: Math.max(0, limit - session.followUps.length),
    });
  }

  /** The raw document, for the job. */
  async rawSession(sessionId: string): Promise<AskSessionDocument | null> {
    return AskSessionModel.findById(sessionId).exec();
  }

  private noSession() {
    return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.ask.SESSION_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
}

export const askService = AskService.getInstance();
