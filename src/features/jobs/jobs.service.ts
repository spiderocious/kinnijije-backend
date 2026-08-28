import { JOB_STATUSES, JobModel, TERMINAL_STATUSES } from '@lib/jobs/jobs.model.js';
import { toJobView, type JobView } from '@lib/jobs/jobs.types.js';
import { logger } from '@lib/logger/index.js';
import { clampLimit } from '@lib/pagination.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

export class JobsService {
  private static instance: JobsService | undefined;

  static getInstance(): JobsService {
    JobsService.instance ??= new JobsService();
    return JobsService.instance;
  }

  /** Every read is owner-scoped — a job id is not a capability. */
  async get(jobId: string, ownerId: string): Promise<ServiceResult<JobView>> {
    const job = await JobModel.findOne({ _id: jobId, ownerId }).exec();
    if (job === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.jobs.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(toJobView(job));
  }

  async list(
    ownerId: string,
    query: { status?: string; type?: string; limit?: number },
  ): Promise<ServiceResult<JobView[]>> {
    const filter: Record<string, unknown> = { ownerId };
    if (query.status !== undefined) filter['status'] = query.status;
    if (query.type !== undefined) filter['type'] = query.type;

    const jobs = await JobModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(clampLimit(query.limit))
      .exec();

    return ok(jobs.map(toJobView));
  }

  /**
   * Asks a running job to stop.
   *
   * Cancellation is cooperative: a queued job is stopped outright, but a
   * running one is only *flagged* — there is no safe way to interrupt work
   * mid-flight, so the handler stops at its next checkpoint.
   */
  async cancel(jobId: string, ownerId: string): Promise<ServiceResult<JobView>> {
    const job = await JobModel.findOne({ _id: jobId, ownerId }).exec();
    if (job === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.jobs.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    if (TERMINAL_STATUSES.includes(job.status)) {
      return fail(
        ERROR_CODES.JOB_NOT_CANCELLABLE,
        MESSAGE_KEYS.jobs.NOT_CANCELLABLE,
        HTTP_STATUS.CONFLICT,
        { rejectionReason: `job_already_${job.status}` },
      );
    }

    const updated = await JobModel.findOneAndUpdate(
      { _id: jobId, ownerId },
      {
        $set: {
          cancelRequestedAt: new Date(),
          // A job nobody has picked up yet can be stopped immediately; a
          // running one has to be asked, and its handler decides when.
          ...(job.status === JOB_STATUSES.QUEUED && {
            status: JOB_STATUSES.CANCELLED,
            finishedAt: new Date(),
          }),
        },
      },
      { new: true },
    ).exec();

    if (updated === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.jobs.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    logger.info('job cancellation requested', { job_id: jobId, was: job.status });
    return ok(toJobView(updated));
  }

  /**
   * Puts a finished job back in the queue.
   *
   * Only failed and cancelled jobs can be retried. Re-running a success would
   * duplicate whatever it already did — and the attempt counter is reset so a
   * deliberate retry gets a full set of tries rather than the one it had left.
   */
  async retry(jobId: string, ownerId: string): Promise<ServiceResult<JobView>> {
    const job = await JobModel.findOne({ _id: jobId, ownerId }).exec();
    if (job === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.jobs.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    const retryable: string[] = [JOB_STATUSES.FAILED, JOB_STATUSES.CANCELLED];
    if (!retryable.includes(job.status)) {
      return fail(
        ERROR_CODES.JOB_NOT_RETRYABLE,
        MESSAGE_KEYS.jobs.NOT_RETRYABLE,
        HTTP_STATUS.CONFLICT,
        { rejectionReason: `job_is_${job.status}` },
      );
    }

    const updated = await JobModel.findOneAndUpdate(
      { _id: jobId, ownerId },
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
      { new: true },
    ).exec();

    if (updated === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.jobs.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    logger.info('job retried', { job_id: jobId });
    return ok(toJobView(updated));
  }
}

export const jobsService = JobsService.getInstance();
