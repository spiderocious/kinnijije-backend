import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * Job status.
 *
 *   queued    → waiting for a worker
 *   running   → a worker has it
 *   succeeded → finished, `result` is populated
 *   failed    → gave up after its attempts; `error` says why
 *   cancelled → a person stopped it
 *
 * `failed` and `cancelled` are distinct on purpose: one is the system's fault
 * and worth retrying, the other is a decision and must not be retried
 * automatically.
 */
export const JOB_STATUSES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type JobStatus = (typeof JOB_STATUSES)[keyof typeof JOB_STATUSES];

export const TERMINAL_STATUSES: readonly JobStatus[] = [
  JOB_STATUSES.SUCCEEDED,
  JOB_STATUSES.FAILED,
  JOB_STATUSES.CANCELLED,
];

export interface JobAttributes {
  /** Prefixed with the job type, so an id says what it is: `photo-check_01H…`. */
  _id: string;
  type: string;
  status: JobStatus;
  /** Who queued it. Scopes every read — one person never sees another's jobs. */
  ownerId: string;
  /** 0–1. Workers report it; the transport layer streams it. */
  progress: number;
  /** A short line a person can read while they wait. */
  progressLabel: string | null;
  payload: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  /**
   * Set when someone asks to cancel. A worker checks it between steps — there
   * is no safe way to interrupt work mid-flight, so cancellation is
   * cooperative rather than immediate.
   */
  cancelRequestedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  /**
   * Guards against a worker that died holding a job. Anything running past
   * this is reclaimed, otherwise a crash would strand jobs as permanently
   * "running".
   */
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<JobAttributes>(
  {
    _id: { type: String, required: true },
    type: { type: String, required: true, index: true },
    status: { type: String, required: true, enum: Object.values(JOB_STATUSES), default: JOB_STATUSES.QUEUED, index: true },
    ownerId: { type: String, required: true, index: true },
    progress: { type: Number, required: true, default: 0, min: 0, max: 1 },
    progressLabel: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, default: null },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 3 },
    cancelRequestedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    leaseExpiresAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'jobs', minimize: false },
);

// The claim query: oldest queued job first.
jobSchema.index({ status: 1, createdAt: 1 });
// A person's job list, newest first.
jobSchema.index({ ownerId: 1, createdAt: -1 });

export type JobDocument = HydratedDocument<JobAttributes>;

export const JobModel = model<JobAttributes>('Job', jobSchema);

/**
 * `photo-check_01hv8qjz…` — the type is IN the id.
 *
 * A bare ULID in a log line tells you nothing; this way an id alone says what
 * the work was, which is worth the few extra characters everywhere it appears.
 */
export const buildJobId = (type: string): string => `${type}_${newId('job').split('_')[1] ?? ''}`;
