import { JOB_STATUSES, JobModel } from '@lib/jobs/jobs.model.js';
import { isoOrNull } from '@lib/dates.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

/**
 * The queue, across everybody.
 *
 * Deliberately NOT the consumer job service: that one scopes every read and
 * write to one owner, which is exactly right for a cook and exactly wrong for
 * an operator looking at why the queue is backed up.
 */
export class AdminJobsService {
  private static instance: AdminJobsService | undefined;

  static getInstance(): AdminJobsService {
    AdminJobsService.instance ??= new AdminJobsService();
    return AdminJobsService.instance;
  }

  async list(query: {
    status?: string;
    type?: string;
    ownerId?: string;
    limit?: number;
    skip?: number;
  }): Promise<ServiceResult<{ items: unknown[]; total: number }>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter['status'] = query.status;
    if (query.type !== undefined) filter['type'] = query.type;
    if (query.ownerId !== undefined) filter['ownerId'] = query.ownerId;

    const limit = Math.min(query.limit ?? 50, 200);
    const [rows, total] = await Promise.all([
      JobModel.find(filter)
        // The payload and result can be large; the list does not need them.
        .select('-payload -result')
        .sort({ createdAt: -1 })
        .skip(query.skip ?? 0)
        .limit(limit)
        .exec(),
      JobModel.countDocuments(filter).exec(),
    ]);

    return ok({
      items: rows.map((job) => ({
        id: job._id,
        type: job.type,
        status: job.status,
        owner_id: job.ownerId,
        progress: job.progress,
        progress_label: job.progressLabel,
        attempts: job.attempts,
        max_attempts: job.maxAttempts,
        error: job.error,
        created_at: isoOrNull(job.createdAt),
        started_at: isoOrNull(job.startedAt),
        finished_at: isoOrNull(job.finishedAt),
      })),
      total,
    });
  }

  async detail(jobId: string): Promise<ServiceResult<unknown>> {
    const job = await JobModel.findById(jobId).exec();
    if (job === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.jobs.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    return ok({
      id: job._id,
      type: job.type,
      status: job.status,
      owner_id: job.ownerId,
      progress: job.progress,
      progress_label: job.progressLabel,
      attempts: job.attempts,
      max_attempts: job.maxAttempts,
      payload: job.payload,
      result: job.result,
      error: job.error,
      cancel_requested_at: isoOrNull(job.cancelRequestedAt),
      lease_expires_at: isoOrNull(job.leaseExpiresAt),
      created_at: isoOrNull(job.createdAt),
      started_at: isoOrNull(job.startedAt),
      finished_at: isoOrNull(job.finishedAt),
    });
  }

  /**
   * Put a job back in the queue.
   *
   * `force` is the operator's override: ordinarily only a failed or cancelled
   * job may be retried, but an operator diagnosing a stuck queue needs to be
   * able to re-run a succeeded one too. It is deliberately explicit, so it can
   * never happen by accident.
   */
  async retry(jobId: string, force = false): Promise<ServiceResult<unknown>> {
    const job = await JobModel.findById(jobId).exec();
    if (job === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.jobs.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const retryable: string[] = [JOB_STATUSES.FAILED, JOB_STATUSES.CANCELLED];
    if (!force && !retryable.includes(job.status)) {
      return fail(
        ERROR_CODES.JOB_NOT_RETRYABLE,
        MESSAGE_KEYS.jobs.NOT_RETRYABLE,
        HTTP_STATUS.CONFLICT,
        { rejectionReason: `job_is_${job.status}` },
      );
    }

    await JobModel.updateOne(
      { _id: jobId },
      {
        $set: {
          status: JOB_STATUSES.QUEUED,
          attempts: 0,
          progress: 0,
          progressLabel: null,
          error: null,
          result: null,
          cancelRequestedAt: null,
          startedAt: null,
          finishedAt: null,
          leaseExpiresAt: null,
        },
      },
    ).exec();

    logger.info('job requeued by an operator', { job_id: jobId, was: job.status, force });
    return this.detail(jobId);
  }

  /** Ask a running job to stop. Cooperative — the handler decides when. */
  async cancel(jobId: string): Promise<ServiceResult<unknown>> {
    const job = await JobModel.findById(jobId).exec();
    if (job === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.jobs.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const cancellable: string[] = [JOB_STATUSES.QUEUED, JOB_STATUSES.RUNNING];
    if (!cancellable.includes(job.status)) {
      return fail(
        ERROR_CODES.JOB_NOT_CANCELLABLE,
        MESSAGE_KEYS.jobs.NOT_CANCELLABLE,
        HTTP_STATUS.CONFLICT,
        { rejectionReason: `job_is_${job.status}` },
      );
    }

    await JobModel.updateOne(
      { _id: jobId },
      { $set: { cancelRequestedAt: new Date() } },
    ).exec();

    logger.info('job cancellation requested by an operator', { job_id: jobId });
    return this.detail(jobId);
  }

  /** The distinct job types that exist, for the filter rail. */
  async types(): Promise<ServiceResult<string[]>> {
    const types = await JobModel.distinct('type').exec();
    return ok(types.map(String).sort());
  }
}

export const adminJobsService = AdminJobsService.getInstance();
