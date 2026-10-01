import { isoOrNull } from '@lib/dates.js';
import { JobModel } from '@lib/jobs/jobs.model.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import { toJobView, type JobView } from '@lib/jobs/jobs.types.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import { SCRIPT_JOB_TYPE, type ScriptJobPayload } from './scripts.jobs.js';
import { SCRIPTS, scriptById } from './scripts.registry.js';

export interface ScriptListRow {
  id: string;
  name: string;
  description: string;
  effect: string;
  destructive: boolean;
  supports_dry_run: boolean;
  run_once: boolean;
  can_revert: boolean;
  /**
   * Whether a REAL run has already succeeded. Dry runs do not count — the
   * question is "has this been applied", not "has anybody looked at it".
   */
  has_run: boolean;
  last_run_at: string | null;
  last_outcome: string | null;
  /** True when `run_once` and it has already been applied. */
  run_disabled: boolean;
  /** The last few runs, so an operator can see whether this was already done. */
  recent: JobView[];
}

export class ScriptsService {
  private static instance: ScriptsService | undefined;

  static getInstance(): ScriptsService {
    ScriptsService.instance ??= new ScriptsService();
    return ScriptsService.instance;
  }

  /**
   * Everything runnable, each with its recent history.
   *
   * The history is the point: "has anybody already run the backfill?" is the
   * first question, and answering it from the job log means an operator does
   * not have to guess or run it again to find out.
   */
  async list(): Promise<ServiceResult<ScriptListRow[]>> {
    const runs = await JobModel.find(
      { type: SCRIPT_JOB_TYPE },
      { payload: 1, status: 1, result: 1, error: 1, progress: 1, progressLabel: 1, attempts: 1, maxAttempts: 1, createdAt: 1, startedAt: 1, finishedAt: 1, type: 1, ownerId: 1 },
    )
      .sort({ createdAt: -1 })
      .limit(60)
      .exec();

    return ok(
      SCRIPTS.map((script) => {
        const mine = runs.filter(
          (job) => (job.payload as ScriptJobPayload | null)?.scriptId === script.id,
        );

        // A REAL run that succeeded. A dry run tells you nothing about whether
        // the change was applied, so it cannot satisfy `runOnce`.
        const applied = mine.find((job) => {
          const payload = job.payload as ScriptJobPayload | null;
          return (
            job.status === 'succeeded' &&
            // A preview is not an application, and an undo is not one either.
            payload?.dryRun === false &&
            payload.mode !== 'revert'
          );
        });
        const last = mine[0];

        return {
          id: script.id,
          name: script.name,
          description: script.description,
          effect: script.effect,
          destructive: script.destructive,
          supports_dry_run: script.supportsDryRun,
          run_once: script.runOnce,
          can_revert: script.revert !== undefined,
          has_run: applied !== undefined,
          last_run_at: isoOrNull(last?.createdAt ?? null),
          last_outcome: last?.status ?? null,
          run_disabled: script.runOnce && applied !== undefined,
          recent: mine.slice(0, 5).map(toJobView),
        };
      }),
    );
  }

  /**
   * Queues a run.
   *
   * Returns the job rather than the result: a migration over a large
   * collection must not be held open on an HTTP request, and the job screen
   * already knows how to follow one.
   */
  async run(
    scriptId: string,
    dryRun: boolean,
    actor: { id: string; email: string; role: string },
    mode: 'run' | 'revert' = 'run',
  ): Promise<ServiceResult<JobView>> {
    const script = scriptById(scriptId);
    if (script === undefined) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.scripts.NOT_FOUND, HTTP_STATUS.NOT_FOUND, {
        rejectionReason: 'unknown_script',
      });
    }

    // Refusing a second concurrent run of the SAME script: two backfills
    // racing over one collection is how you get a half-applied migration.
    const alreadyRunning = await JobModel.findOne({
      type: SCRIPT_JOB_TYPE,
      status: { $in: ['queued', 'running'] },
      'payload.scriptId': scriptId,
    })
      .lean()
      .exec();

    if (alreadyRunning !== null) {
      return fail(ERROR_CODES.ALREADY_EXISTS, MESSAGE_KEYS.scripts.ALREADY_RUNNING, HTTP_STATUS.CONFLICT, {
        rejectionReason: 'script_already_running',
      });
    }

    if (mode === 'revert' && script.revert === undefined) {
      return fail(ERROR_CODES.VALIDATION_ERROR, MESSAGE_KEYS.scripts.NOT_FOUND, HTTP_STATUS.UNPROCESSABLE, {
        rejectionReason: 'script_cannot_be_reverted',
      });
    }

    /**
     * A one-off that has already been applied is refused SERVER-SIDE too.
     *
     * The console disables the button, but a disabled button is a courtesy —
     * the guarantee has to be here, or a second backfill is one curl away.
     */
    if (mode === 'run' && !dryRun && script.runOnce) {
      const alreadyApplied = await JobModel.findOne({
        type: SCRIPT_JOB_TYPE,
        status: 'succeeded',
        'payload.scriptId': scriptId,
        'payload.dryRun': false,
        'payload.mode': { $ne: 'revert' },
      })
        .lean()
        .exec();

      if (alreadyApplied !== null) {
        return fail(ERROR_CODES.ALREADY_EXISTS, MESSAGE_KEYS.scripts.ALREADY_RUN, HTTP_STATUS.CONFLICT, {
          rejectionReason: 'script_is_one_off_and_has_run',
        });
      }
    }

    const payload: ScriptJobPayload = {
      scriptId,
      mode,
      // A script that cannot preview is always a real run, whatever was asked.
      dryRun: script.supportsDryRun ? dryRun : false,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
    };

    const job = await jobQueue.enqueue({
      type: SCRIPT_JOB_TYPE,
      ownerId: actor.id,
      payload,
      // NOT retried. A half-applied migration retried automatically turns one
      // problem into two; an operator decides whether to run it again.
      maxAttempts: 1,
    });

    return ok(toJobView(job));
  }
}

export const scriptsService = ScriptsService.getInstance();
