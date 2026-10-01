import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * One Ask conversation.
 *
 * THE SESSION IS THE IDENTITY. Everything else in this codebase keys work to an
 * `ownerId` — `filesService.requestUpload()` demands one, `JobModel.ownerId` is
 * required, every `/jobs` route sits behind `authenticate`. Ask must work
 * signed out, so none of that fits, and the answer is this row: an unguessable
 * id the browser holds in `sessionStorage` and presents on every call.
 *
 * That makes the id a bearer token for this conversation. It is unguessable
 * (a ULID) and short-lived (30 days), but it is the reason every read in
 * `ask.service.ts` scopes to the session rather than to a bare turn id.
 *
 * `ownerId` is set when somebody is signed in, so history still attaches — but
 * it is never REQUIRED, which is the whole point.
 */

/** Thirty days. Long enough to study a session, short enough not to accumulate. */
const TTL_DAYS = 30;

export interface AskTurnRecord {
  _id: string;
  /** Which question this answered. */
  step: string;
  /** How they answered it. */
  source: 'tap' | 'text' | 'voice';
  /**
   * What they actually said, verbatim.
   *
   * Kept because somebody speaking for twenty seconds says far more than four
   * answers' worth, and dropping the rest is how a voice feature ends up worse
   * than tapping. Null for a tap, which has no text.
   */
  rawText: string | null;
  /** Where the audio lived. Cleared once transcription finishes. */
  audioKey: string | null;
  /** Constraints that are not answers: "no pepper", "cooking for two". */
  notes: string[];
  /**
   * What the sentence actually answered. Null until a parse settles, and null
   * forever for a tap, which carries its answer in the client's draft.
   *
   * Stored on the row rather than held in memory: a job and a request can run
   * in different processes, and a restart between them must not lose what
   * somebody said.
   */
  answers: {
    kitchenItems: string[];
    mood: string | null;
    weight: string | null;
    minutes: number | null;
  } | null;
  /** Said, food-like, unplaceable. Shown so it can be corrected. */
  unmatched: string[];
  /** The model's self-reported confidence in the parse, 0–1. Null for a tap. */
  confidence: number | null;
  status: 'pending' | 'transcribing' | 'parsing' | 'done' | 'failed';
  /** Which stage failed, when one did. */
  failedStage: string | null;
  errorCode: string | null;
  /** Split timings, so a slow turn can be blamed on the right stage. */
  transcribeMs: number | null;
  parseMs: number | null;
  createdAt: Date;
}

export interface AskSessionAttributes {
  _id: string;
  /** Set when signed in. Absent for a guest, which is the normal case. */
  ownerId: string | null;
  /** Salted hash, same stance as the decide log: countable, never identifying. */
  ipHash: string;
  turns: AskTurnRecord[];
  /** Every note across every turn, so a constraint from step one survives to step four. */
  carriedNotes: string[];
  /** Set once the session produced a verdict. */
  verdictMealId: string | null;
  /**
   * Free-text exchanges about the verdict, after the four questions.
   *
   * Counted and CAPPED on the server. A cap enforced only in the UI is not a
   * cap: this endpoint spends money at OpenAI on a public route, and the limit
   * is the thing standing between a stranger and an unbounded bill.
   */
  followUps: {
    _id: string;
    question: string;
    answer: string;
    /** Which meal they ended up with, when the reply changed it. */
    mealId: string | null;
    refused: boolean;
    createdAt: Date;
  }[];
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const turnSchema = new Schema<AskTurnRecord>(
  {
    _id: { type: String, default: () => newId('askTurn') },
    step: { type: String, required: true },
    source: { type: String, required: true, enum: ['tap', 'text', 'voice'] },
    rawText: { type: String, default: null },
    audioKey: { type: String, default: null },
    notes: { type: [String], default: [] },
    answers: {
      type: new Schema(
        {
          kitchenItems: { type: [String], default: [] },
          mood: { type: String, default: null },
          weight: { type: String, default: null },
          minutes: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    unmatched: { type: [String], default: [] },
    confidence: { type: Number, default: null },
    status: {
      type: String,
      required: true,
      default: 'pending',
      enum: ['pending', 'transcribing', 'parsing', 'done', 'failed'],
    },
    failedStage: { type: String, default: null },
    errorCode: { type: String, default: null },
    transcribeMs: { type: Number, default: null },
    parseMs: { type: Number, default: null },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } },
);

const askSessionSchema = new Schema<AskSessionAttributes>(
  {
    _id: { type: String, default: () => newId('askSession') },
    ownerId: { type: String, default: null, index: true },
    ipHash: { type: String, required: true, index: true },
    turns: { type: [turnSchema], default: [] },
    carriedNotes: { type: [String], default: [] },
    verdictMealId: { type: String, default: null },
    followUps: {
      type: [
        new Schema(
          {
            _id: { type: String, default: () => newId('askTurn') },
            question: { type: String, required: true },
            answer: { type: String, required: true },
            mealId: { type: String, default: null },
            refused: { type: Boolean, default: false },
          },
          { _id: false, timestamps: { createdAt: true, updatedAt: false } },
        ),
      ],
      default: [],
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'ask_sessions' },
);

/**
 * Expiry, enforced by Mongo rather than by a job we might forget to run.
 *
 * These rows hold what a guest SAID, which the decide log deliberately never
 * does. A TTL is the difference between "kept while useful" and "kept".
 */
askSessionSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: TTL_DAYS * 24 * 60 * 60 },
);

export type AskSessionDocument = HydratedDocument<AskSessionAttributes>;
export const AskSessionModel = model<AskSessionAttributes>('AskSession', askSessionSchema);
