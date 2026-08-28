import type { JobDocument, JobStatus } from './jobs.model.js';
import { isoOrNull } from '@lib/dates.js';

/**
 * What a handler gets. Deliberately narrow: a handler should not be able to
 * reach into the queue and move other jobs around.
 */
export interface JobContext {
  readonly jobId: string;
  readonly ownerId: string;
  readonly attempt: number;
  /** Report progress. Values outside 0–1 are clamped rather than rejected. */
  readonly setProgress: (fraction: number, label?: string) => Promise<void>;
  /**
   * True once someone asked to cancel.
   *
   * Cancellation is COOPERATIVE — there is no safe way to interrupt work
   * mid-flight, so a long handler must check this between steps and return
   * early. A handler that never checks simply runs to completion.
   */
  readonly isCancelled: () => Promise<boolean>;
}

export type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  context: JobContext,
) => Promise<TResult>;

export interface EnqueueOptions {
  readonly type: string;
  readonly ownerId: string;
  readonly payload: unknown;
  readonly maxAttempts?: number;
  /** Hold it until this moment. Omit to run as soon as a worker is free. */
  readonly runAt?: Date;
}

export interface JobView {
  id: string;
  type: string;
  status: JobStatus;
  progress: number;
  progress_label: string | null;
  result: unknown;
  error: string | null;
  attempts: number;
  max_attempts: number;
  /** True while a person could still usefully wait on it. */
  is_terminal: boolean;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export const toJobView = (doc: JobDocument): JobView => ({
  id: doc._id,
  type: doc.type,
  status: doc.status,
  progress: doc.progress,
  progress_label: doc.progressLabel,
  result: doc.result,
  error: doc.error,
  attempts: doc.attempts,
  max_attempts: doc.maxAttempts,
  is_terminal: ['succeeded', 'failed', 'cancelled'].includes(doc.status),
  created_at: isoOrNull(doc.createdAt),
  started_at: isoOrNull(doc.startedAt),
  finished_at: isoOrNull(doc.finishedAt),
});
