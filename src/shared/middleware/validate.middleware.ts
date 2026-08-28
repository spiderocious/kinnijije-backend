import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

import { AppError } from '@lib/errors.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';
import { fieldErrorsFromZod } from '@shared/utils/zod.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validates one part of the request against a schema and REPLACES it with the
 * parsed result, so downstream handlers get coerced, typed, stripped data
 * rather than raw strings. Unknown keys are dropped by Zod's default object
 * behaviour — a client cannot smuggle an extra field into a service.
 */
export const validate =
  (schema: ZodTypeAny, source: Source = 'body'): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed: unknown = schema.parse(req[source]);

      if (source === 'body') {
        req.body = parsed;
      } else {
        // req.query and req.params have getter-only definitions on some Express
        // versions; defineProperty assigns without tripping that.
        Object.defineProperty(req, source, { value: parsed, writable: true, configurable: true });
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const fieldErrors = fieldErrorsFromZod(error);

        /**
         * Surface the actual reason, not the generic line.
         *
         * "Some of the details you sent are not valid" tells somebody nothing
         * they can act on. When there is exactly one problem — or one that
         * belongs to the whole request rather than a field — that message IS
         * the useful one, so it becomes the envelope's `message` and the
         * interface can show it directly.
         */
        const allMessages = Object.values(fieldErrors).flat();
        const rootMessage = fieldErrors['_root']?.[0];
        const singleMessage = allMessages.length === 1 ? allMessages[0] : undefined;
        const specific = rootMessage ?? singleMessage;

        next(
          new AppError(
            ERROR_CODES.VALIDATION_ERROR,
            HTTP_STATUS.UNPROCESSABLE,
            specific ?? `validation failed on ${source}`,
            MESSAGE_KEYS.common.VALIDATION_ERROR,
            fieldErrors,
            `invalid_${source}`,
            undefined,
            specific,
          ),
        );
        return;
      }
      next(error);
    }
  };

/** Typed accessor for a body already validated by `validate(schema)`. */
export const validated = <T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> =>
  req.body as z.infer<T>;
