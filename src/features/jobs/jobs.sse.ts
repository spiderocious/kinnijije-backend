import type { Request, Response } from 'express';

import { jobQueue } from '@lib/jobs/jobs.queue.js';
import { JobModel } from '@lib/jobs/jobs.model.js';
import { toJobView } from '@lib/jobs/jobs.types.js';
import { logger } from '@lib/logger/index.js';

/**
 * Live job progress over Server-Sent Events.
 *
 * SSE rather than WebSockets: this is one-way, it reconnects on its own, and it
 * rides ordinary HTTP — no upgrade, no extra infrastructure. Polling stays
 * first-class for anything that only needs a final answer.
 *
 * A stream is always safe to fall back from: every event it sends is also
 * readable from `GET /jobs/:id`, so a client that cannot hold a connection
 * loses nothing but immediacy.
 */

/**
 * A comment line every 25 seconds.
 *
 * Proxies and load balancers close idle connections, usually at 30–60s. A job
 * that thinks for a minute without emitting would have its stream cut, and the
 * client would see a silent disconnect rather than a result.
 */
const HEARTBEAT_MS = 25_000;

/** Nothing runs forever. A stream past this is almost certainly abandoned. */
const MAX_STREAM_MS = 15 * 60 * 1000;

export async function streamJob(req: Request, res: Response, ownerId: string): Promise<void> {
  const { jobId } = req.params as { jobId: string };

  const job = await JobModel.findOne({ _id: jobId, ownerId }).exec();
  if (job === null) {
    // Not a stream at all — a 404 before any SSE headers, so the client's
    // ordinary error handling applies.
    res.status(404).json({
      error: { code: 'not_found', message: 'That job does not exist.', severity: 50 },
    });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx buffers responses by default, which holds every event until the
    // stream closes — the exact opposite of the point.
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // The current state first: a client that connects late must not wait for the
  // next event to learn where things stand.
  send('state', toJobView(job));

  // Already finished — say so and close rather than holding a pointless socket.
  if (['succeeded', 'failed', 'cancelled'].includes(job.status)) {
    send('done', toJobView(job));
    res.end();
    return;
  }

  const channel = `job:${jobId}`;

  const onEvent = (payload: { type: string }): void => {
    if (payload.type === 'progress') {
      send('progress', payload);
      return;
    }

    if (payload.type === 'finished') {
      // Re-read rather than trusting the event: the document is the truth, and
      // the client should get exactly what a later GET would return.
      void JobModel.findById(jobId)
        .exec()
        .then((fresh) => {
          if (fresh !== null) send('done', toJobView(fresh));
          cleanup();
          res.end();
        })
        .catch(() => {
          cleanup();
          res.end();
        });
    }
  };

  const heartbeat = setInterval(() => {
    // A comment line: valid SSE, ignored by clients, keeps proxies open.
    res.write(': keep-alive\n\n');
  }, HEARTBEAT_MS);

  const timeout = setTimeout(() => {
    send('timeout', { message: 'Stream closed. Poll the job for its result.' });
    cleanup();
    res.end();
  }, MAX_STREAM_MS);

  function cleanup(): void {
    jobQueue.events.off(channel, onEvent);
    clearInterval(heartbeat);
    clearTimeout(timeout);
  }

  jobQueue.events.on(channel, onEvent);

  // A client that navigates away must not leak a listener and a timer.
  req.on('close', () => {
    cleanup();
    logger.debug('job stream closed by client', { job_id: jobId });
  });
}
