import type { Request, Response } from 'express';

import { logger } from '@lib/logger/index.js';

import { askService, type AskTurnView } from './ask.service.js';

/**
 * One turn, followed live.
 *
 * Deliberately NOT the `/jobs` stream. That one sits behind `authenticate` and
 * keys on `ownerId`, and Ask has guests — so this is its own route, scoped to
 * the session id the caller presents. Reusing the jobs stream would have meant
 * loosening its auth, which is the wrong trade: a feature should not weaken an
 * existing guarantee to borrow its plumbing.
 *
 * Every event sent here is also readable from `GET /ask/:sessionId/turns/:id`.
 * A client that cannot hold a connection polls instead and loses immediacy,
 * nothing more. That rule comes from `jobs.sse.ts` and it is a good one.
 */

/** Proxies close idle connections at 30–60s. A comment line keeps ours open. */
const HEARTBEAT_MS = 25_000;

/** How often the turn is re-read. Cheap: one document by id. */
const POLL_MS = 400;

/** Transcribe plus parse is seconds, not minutes. Past this it is abandoned. */
const MAX_STREAM_MS = 90_000;

function send(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Which event a status maps to.
 *
 * The transcript is its own event rather than part of `done`, because the raw
 * text exists well before the parse finishes and showing it immediately is the
 * whole payoff of streaming — somebody who spoke sees that we heard them while
 * the rest is still being worked out.
 */
export async function streamTurn(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId ?? '';
  const turnId = req.params.turnId ?? '';

  const first = await askService.getTurn(sessionId, turnId);
  if (!first.success) {
    res.status(404).json({ error: { code: 'not_found', message: 'No such turn.' } });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx buffers event streams by default, which defeats the entire point.
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  /** What the client has already been told, so nothing is sent twice. */
  let lastStatus = '';
  let sentTranscript = false;

  const finish = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    clearInterval(beat);
    res.end();
  };

  const push = (turn: AskTurnView): void => {
    if (turn.raw_text !== null && !sentTranscript) {
      sentTranscript = true;
      send(res, 'transcript', { turn_id: turn.id, text: turn.raw_text });
    }

    if (turn.status !== lastStatus) {
      lastStatus = turn.status;
      if (turn.status === 'failed') {
        send(res, 'failed', {
          turn_id: turn.id,
          stage: turn.failed_stage,
          error_code: turn.error_code,
        });
        finish();
        return;
      }
      if (turn.status === 'done') {
        send(res, 'parsed', turn);
        finish();
        return;
      }
      send(res, turn.status, { turn_id: turn.id });
    }
  };

  push(first.data);
  if (closed) return;

  const poll = setInterval(() => {
    void (async () => {
      const current = await askService.getTurn(sessionId, turnId);
      if (!current.success) {
        finish();
        return;
      }
      push(current.data);
    })().catch((error: unknown) => {
      logger.warn('ask stream poll failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      finish();
    });
  }, POLL_MS);

  const beat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, HEARTBEAT_MS);

  const cap = setTimeout(finish, MAX_STREAM_MS);

  // A client that navigates away must not leave a timer running.
  req.on('close', () => {
    clearTimeout(cap);
    finish();
  });
}
