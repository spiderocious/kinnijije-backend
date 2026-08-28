import { EventEmitter } from 'node:events';

import { logger } from '@lib/logger/index.js';

import { buildJobId, JOB_STATUSES, JobModel, type JobDocument } from './jobs.model.js';
import type { EnqueueOptions, JobContext, JobHandler } from './jobs.types.js';

/**
 * An in-process job queue backed by Mongo.
 *
 * **It knows nothing about AI.** AI is simply its first consumer. That
 * separation is the point: swapping this for Redis or BullMQ later means
 * writing one new implementation of the same surface, not touching every
 * feature that queues work.
 *
 * Jobs live in Mongo rather than memory so a restart does not lose them —
 * an in-flight job is reclaimed by the next worker when its lease expires.
 */

/** How long a worker holds a job before it is considered dead. */
const LEASE_MS = 5 * 60 * 1000;

/** How often the loop looks for work. */
const POLL_MS = 500;

/**
 * How many jobs run at once.
 *
 * Deliberately small: these are network-bound AI calls, and this shares a
 * process with the API. Saturating the event loop here would make every
 * ordinary request slow.
 */
const CONCURRENCY = 3;

class JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private started = false;

  /** Progress and completion events, for the SSE layer to subscribe to. */
  readonly events = new EventEmitter();

  private static instance: JobQueue | undefined;

  static getInstance(): JobQueue {
    JobQueue.instance ??= new JobQueue();
    return JobQueue.instance;
  }

  constructor() {
    // One emitter serves every open stream; the default cap of 10 would warn
    // as soon as a handful of clients watch jobs at once.
    this.events.setMaxListeners(0);
  }

  register<TPayload, TResult>(type: string, handler: JobHandler<TPayload, TResult>): void {
    if (this.handlers.has(type)) {
      // A silent overwrite would mean the wrong handler runs, which is far
      // worse to debug than a loud refusal at boot.
      throw new Error(`Job handler already registered for type: ${type}`);
    }
    this.handlers.set(type, handler as JobHandler);
  }

  async enqueue(options: EnqueueOptions): Promise<JobDocument> {
    if (!this.handlers.has(options.type)) {
      throw new Error(`No handler registered for job type: ${options.type}`);
    }

    const job = await JobModel.create({
      _id: buildJobId(options.type),
      type: options.type,
      ownerId: options.ownerId,
      payload: options.payload,
      maxAttempts: options.maxAttempts ?? 3,
    });

    logger.info('job enqueued', { job_id: job._id, type: job.type });
    return job;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_MS);
    // The loop must not hold the process open on shutdown.
    this.timer.unref();

    logger.info('job worker started', { concurrency: CONCURRENCY, types: [...this.handlers.keys()] });
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
  }

  private async tick(): Promise<void> {
    if (this.running.size >= CONCURRENCY) return;

    try {
      await this.reclaimStalled();

      const free = CONCURRENCY - this.running.size;
      for (let i = 0; i < free; i += 1) {
        const job = await this.claimNext();
        if (job === null) break;
        // Deliberately not awaited: the loop must keep claiming while this runs.
        void this.run(job);
      }
    } catch (error) {
      // A failure here must not kill the interval, or the queue silently stops.
      logger.error('job tick failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Takes one queued job, atomically.
   *
   * `findOneAndUpdate` is the whole trick: reading then writing would let two
   * workers claim the same job. Even in one process this matters, because
   * `tick` can overlap with itself across timers.
   */
  private async claimNext(): Promise<JobDocument | null> {
    const types = [...this.handlers.keys()];
    if (types.length === 0) return null;

    return JobModel.findOneAndUpdate(
      { status: JOB_STATUSES.QUEUED, type: { $in: types } },
      {
        $set: {
          status: JOB_STATUSES.RUNNING,
          startedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } },
    ).exec();
  }

  /**
   * Puts back anything whose worker died.
   *
   * Without this a crash mid-job leaves it "running" forever — invisible to
   * the queue and never retried.
   */
  private async reclaimStalled(): Promise<void> {
    const stalled = await JobModel.updateMany(
      {
        status: JOB_STATUSES.RUNNING,
        leaseExpiresAt: { $lt: new Date() },
        _id: { $nin: [...this.running] },
      },
      { $set: { status: JOB_STATUSES.QUEUED, leaseExpiresAt: null } },
    ).exec();

    if (stalled.modifiedCount > 0) {
      logger.warn('reclaimed stalled jobs', { count: stalled.modifiedCount });
    }
  }

  private async run(job: JobDocument): Promise<void> {
    this.running.add(job._id);
    const handler = this.handlers.get(job.type);

    if (handler === undefined) {
      await this.fail(job, `No handler for type ${job.type}`, true);
      this.running.delete(job._id);
      return;
    }

    const context: JobContext = {
      jobId: job._id,
      ownerId: job.ownerId,
      attempt: job.attempts,
      setProgress: async (fraction, label) => {
        const clamped = Math.max(0, Math.min(1, fraction));
        await JobModel.updateOne(
          { _id: job._id },
          {
            $set: {
              progress: clamped,
              ...(label !== undefined && { progressLabel: label }),
              // Renew the lease: a long job that is visibly working must not
              // be reclaimed out from under itself.
              leaseExpiresAt: new Date(Date.now() + LEASE_MS),
            },
          },
        ).exec();
        this.events.emit(`job:${job._id}`, { type: 'progress', progress: clamped, label: label ?? null });
      },
      isCancelled: async () => {
        const fresh = await JobModel.findById(job._id).select('cancelRequestedAt').exec();
        return fresh?.cancelRequestedAt !== null && fresh?.cancelRequestedAt !== undefined;
      },
    };

    try {
      const result = await handler(job.payload, context);

      // A cancel that arrived while the handler ran must win — otherwise a
      // cancelled job still reports success and its result gets used.
      if (await context.isCancelled()) {
        await this.finish(job._id, JOB_STATUSES.CANCELLED, null, 'Cancelled while running');
        return;
      }

      await this.finish(job._id, JOB_STATUSES.SUCCEEDED, result, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.fail(job, message, false);
    } finally {
      this.running.delete(job._id);
    }
  }

  /** Retries while attempts remain; gives up loudly once they run out. */
  private async fail(job: JobDocument, message: string, fatal: boolean): Promise<void> {
    const exhausted = fatal || job.attempts >= job.maxAttempts;

    if (!exhausted) {
      logger.warn('job failed, will retry', { job_id: job._id, attempt: job.attempts, error: message });
      await JobModel.updateOne(
        { _id: job._id },
        { $set: { status: JOB_STATUSES.QUEUED, error: message, leaseExpiresAt: null } },
      ).exec();
      return;
    }

    logger.error('job failed permanently', { job_id: job._id, attempts: job.attempts, error: message });
    await this.finish(job._id, JOB_STATUSES.FAILED, null, message);
  }

  private async finish(
    jobId: string,
    status: typeof JOB_STATUSES[keyof typeof JOB_STATUSES],
    result: unknown,
    error: string | null,
  ): Promise<void> {
    // Built explicitly rather than with an undefined value: an undefined in a
    // $set writes null on this driver, which would wipe the progress a failed
    // job had reached.
    const update: Record<string, unknown> = {
      status,
      result,
      error,
      finishedAt: new Date(),
      leaseExpiresAt: null,
    };
    if (status === JOB_STATUSES.SUCCEEDED) update['progress'] = 1;

    await JobModel.updateOne({ _id: jobId }, { $set: update }).exec();

    this.events.emit(`job:${jobId}`, { type: 'finished', status, result, error });
  }
}

export const jobQueue = JobQueue.getInstance();
