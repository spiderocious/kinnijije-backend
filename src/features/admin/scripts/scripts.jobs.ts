import { record } from '@lib/audit/index.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import type { JobContext } from '@lib/jobs/jobs.types.js';
import { logger } from '@lib/logger/index.js';

import { scriptById } from './scripts.registry.js';

/**
 * Operator scripts run as ordinary background jobs.
 *
 * That is the whole design decision. The queue already has everything this
 * needs — durable execution across a restart, progress reporting, a result
 * field, attempt limits, cooperative cancellation, and a console screen that
 * shows all of it. Building a bespoke runner would mean reimplementing each of
 * those, worse.
 *
 * `maxAttempts: 1` though: a half-applied migration retried automatically is
 * how a bad afternoon becomes a bad week. An operator decides whether to run
 * it again.
 */
export const SCRIPT_JOB_TYPE = 'admin-script';

export interface ScriptJobPayload {
  readonly scriptId: string;
  /** `revert` undoes the last real run, where the script supports it. */
  readonly mode: 'run' | 'revert';
  readonly dryRun: boolean;
  /** Carried so the audit row names a person rather than the queue. */
  readonly actorId: string;
  readonly actorEmail: string;
  readonly actorRole: string;
}

async function runScript(payload: unknown, job: JobContext): Promise<unknown> {
  const input = payload as ScriptJobPayload;
  const script = scriptById(input.scriptId);

  // Defensive: the id was validated at the route, but a queued job can outlive
  // a deploy that removed the script it names.
  if (script === undefined) {
    throw new Error(`unknown script: ${input.scriptId}`);
  }

  const reverting = input.mode === 'revert';
  const execute = reverting ? script.revert : script.run;

  if (execute === undefined) {
    throw new Error(`script ${script.id} cannot be reverted`);
  }

  const startedAt = Date.now();
  await job.setProgress(0.05, reverting ? 'reverting' : 'starting');

  try {
    const result = await execute({ job, dryRun: input.dryRun });

    await job.setProgress(1, 'done');
    logger.info('operator script finished', {
      script: script.id,
      dry_run: input.dryRun,
      duration_ms: Date.now() - startedAt,
    });

    record({
      action: reverting
        ? 'scripts.reverted'
        : input.dryRun
          ? 'scripts.previewed'
          : 'scripts.ran',
      resource: 'scripts',
      resourceId: script.id,
      meta: {
        mode: input.mode,
        dry_run: input.dryRun,
        destructive: script.destructive,
        duration_ms: Date.now() - startedAt,
        // The result IS the record. Whoever reads the trail later wants to
        // know what it changed, not merely that somebody ran something.
        result,
      },
      // From the payload rather than the request context: a job runs on the
      // worker, long after the request that queued it has gone.
      actor: { id: input.actorId, email: input.actorEmail, role: input.actorRole },
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    record({
      action: 'scripts.failed',
      resource: 'scripts',
      resourceId: script.id,
      outcome: 'error',
      meta: { mode: input.mode, dry_run: input.dryRun, error: message },
      actor: { id: input.actorId, email: input.actorEmail, role: input.actorRole },
    });

    // Rethrown so the job is marked failed and the operator sees it.
    throw error;
  }
}

export function registerScriptJobs(): void {
  jobQueue.register(SCRIPT_JOB_TYPE, runScript);
}
