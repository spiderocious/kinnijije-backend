/**
 * The names both the service and the job need.
 *
 * In their own module to break a cycle: the service enqueues the job, and the
 * job calls back into the service. A shared constant imported from one into the
 * other would make that cycle real.
 */

export const ASK_TURN_JOB_TYPE = 'ask.turn';

export interface AskTurnJobPayload {
  sessionId: string;
  turnId: string;
  /** `follow_up` transcribes only — see ask.jobs.ts. */
  step?: string;
  /** Present for a voice note. Absent when they typed. */
  audioKey?: string;
  /** Present when they typed. Absent for a voice note, which produces it. */
  text?: string;
}

/**
 * The questions, in the order they are asked. Mirrors DECIDE_STAGES.
 *
 * `follow_up` is not a question — it is talking back to a verdict that has
 * already landed. It rides the same turn pipeline so a voice note is recorded,
 * uploaded and transcribed identically, but the job TRANSCRIBES ONLY: there are
 * no four answers to extract from "can I use chicken instead".
 */
export const ASK_STEPS = ['kitchen', 'mood', 'weight', 'time', 'follow_up'] as const;
export type AskStep = (typeof ASK_STEPS)[number];
