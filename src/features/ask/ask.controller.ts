import type { Request, Response } from 'express';

import { FEATURE_FLAGS, flagsService } from '@lib/flags/index.js';
import { ResponseUtil } from '@lib/response.js';
import { bail, fail } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/index.js';

import { askService } from './ask.service.js';
import type { CreateTurnInput, FollowUpInput, UploadTicketInput } from './ask.schema.js';

/**
 * Ask KinniJije.
 *
 * PUBLIC and unauthenticated throughout. The session id is the credential, and
 * the service scopes every read to it — which is why a wrong id returns 404
 * rather than 403: a 403 would confirm the session exists.
 */

/** The whole feature, in one check. */
async function askIsOn(): Promise<boolean> {
  return flagsService.isOn(FEATURE_FLAGS.ASK_CHAT);
}

const disabled = () =>
  fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.ask.DISABLED, HTTP_STATUS.NOT_FOUND, {
    rejectionReason: 'ask_chat_disabled',
  });

export const askController = {
  start: async (req: Request, res: Response): Promise<void> => {
    if (!(await askIsOn())) return bail(disabled());

    const result = await askService.startSession(req.ip ?? 'unknown', req.actor?.userId);
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  session: async (req: Request, res: Response): Promise<void> => {
    if (!(await askIsOn())) return bail(disabled());

    const result = await askService.getSession(req.params.sessionId ?? '');
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  /**
   * A ticket to upload one voice note straight to storage.
   *
   * Gated on ASK_VOICE as well as ASK_CHAT: switching off the microphone has to
   * stop the server accepting recordings, not merely hide the button. A flag
   * that only hides UI is a suggestion.
   */
  uploadTicket: async (req: Request, res: Response): Promise<void> => {
    if (!(await askIsOn())) return bail(disabled());
    if (!(await flagsService.isOn(FEATURE_FLAGS.ASK_VOICE))) return bail(disabled());

    const result = await askService.uploadTicket(
      req.params.sessionId ?? '',
      req.body as UploadTicketInput,
    );
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },

  createTurn: async (req: Request, res: Response): Promise<void> => {
    if (!(await askIsOn())) return bail(disabled());

    const body = req.body as CreateTurnInput;

    // Each input method is independently switchable, and the server is where
    // that has to be enforced.
    if (body.source === 'voice' && !(await flagsService.isOn(FEATURE_FLAGS.ASK_VOICE))) {
      return bail(disabled());
    }
    if (body.source === 'text' && !(await flagsService.isOn(FEATURE_FLAGS.ASK_FREE_TEXT))) {
      return bail(disabled());
    }

    const result = await askService.createTurn(req.params.sessionId ?? '', body);
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  /**
   * Talking back to a verdict.
   *
   * Gated on ASK_FREE_TEXT as well as ASK_CHAT: this IS free text, and
   * switching that off has to stop the server accepting it rather than only
   * hiding the box.
   */
  followUp: async (req: Request, res: Response): Promise<void> => {
    if (!(await askIsOn())) return bail(disabled());
    if (!(await flagsService.isOn(FEATURE_FLAGS.ASK_FREE_TEXT))) return bail(disabled());

    const body = req.body as FollowUpInput;
    const result = await askService.followUp(req.params.sessionId ?? '', {
      question: body.question,
      allowedMealIds: body.allowed_meal_ids,
      context: body.context,
    });
    if (!result.success) return bail(result);
    ResponseUtil.created(res, result.data);
  },

  turn: async (req: Request, res: Response): Promise<void> => {
    if (!(await askIsOn())) return bail(disabled());

    const result = await askService.getTurn(
      req.params.sessionId ?? '',
      req.params.turnId ?? '',
    );
    if (!result.success) return bail(result);
    ResponseUtil.ok(res, result.data);
  },
};
