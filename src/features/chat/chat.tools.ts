import { marketService } from '@features/market/market.service.js';
import { mealsService } from '@features/meals/meals.service.js';
import { StockItemModel } from '@features/stock/stock.model.js';
import { stockService } from '@features/stock/stock.service.js';
import { logger } from '@lib/logger/index.js';
import { resolve } from '@shared/catalogue/index.js';

import {
  RESULT_CODES,
  ToolCallBatchSchema,
  type ToolCall,
  type ToolResult,
} from './chat.tool-contracts.js';

/**
 * Runs the tools a model asked for, and reports back what happened.
 *
 * This is a METHOD, not an endpoint. Nothing outside the chat turn can invoke
 * it, which removes a whole class of problem: there is no route to forge, no
 * id to tamper with, and no way to replay a call out of context.
 *
 * The guarantees, in order of how badly each would hurt if broken:
 *
 *   1. **`ownerId` is a parameter, from the session.** It is never read from
 *      the model's output. A model has no vocabulary for addressing another
 *      person's data because it is never given one.
 *   2. **Names in, ids resolved here.** A model-supplied catalogue id would be
 *      a model-supplied target; it gives a name and we look it up.
 *   3. **Re-validated at the point of effect.** The batch is parsed again here
 *      even though it was parsed on arrival — a check at the edge is not a
 *      check where the write happens.
 *   4. **Failures are per-call and structured.** One impossible action does not
 *      sink the batch, and the model is told exactly which one and why.
 */
export async function executeToolCalls(
  ownerId: string,
  rawCalls: unknown,
): Promise<ToolResult[]> {
  const parsed = ToolCallBatchSchema.safeParse(rawCalls);

  if (!parsed.success) {
    logger.warn('rejected malformed tool batch', {
      owner: ownerId,
      issues: parsed.error.issues.slice(0, 5),
    });
    return [
      {
        tool: 'unknown',
        toolGroup: 'unknown',
        toolPayload: rawCalls,
        result: 'failed',
        resultCode: RESULT_CODES.INVALID_PAYLOAD,
        error:
          'That request did not match any tool this app offers. Do not retry it — explain to the person what you can actually do.',
      },
    ];
  }

  const results: ToolResult[] = [];

  // Sequential on purpose: two calls in one batch can touch the same row
  // ("add rice" then "remove rice"), and running them in parallel would make
  // the outcome depend on which finished first.
  for (const call of parsed.data) {
    results.push(await runOne(ownerId, call));
  }

  return results;
}

async function runOne(ownerId: string, call: ToolCall): Promise<ToolResult> {
  const base = { tool: call.tool, toolGroup: call.toolGroup, toolPayload: call.toolPayload };

  try {
    switch (call.tool) {
      case 'addToStock': {
        const items = call.toolPayload.items.map((item) => {
          const match = resolve(item.name);
          return {
            ...(match !== null && { catalogue_id: match.id }),
            name: match?.name ?? item.name,
            quantity: item.quantity ?? 1,
            // A unit the model invented is replaced by the catalogue's default
            // rather than rejected — the person asked for the ingredient, not
            // for a lesson in our unit vocabulary.
            unit: item.unit ?? match?.defaultUnit ?? 'piece',
          };
        });

        const added = await stockService.add(ownerId, {
          items,
          source: 'manual',
          reference: 'Added by the assistant',
        });

        if (!added.success) {
          return {
            ...base,
            result: 'failed',
            resultCode: RESULT_CODES.IMPOSSIBLE_STATE,
            error: added.overrideMessage ?? 'Could not add those to the kitchen.',
          };
        }

        const stock = await stockService.list(ownerId);
        return {
          ...base,
          result: 'success',
          resultCode: RESULT_CODES.OK,
          updatedData: {
            added: items.map((item) => `${item.name} (${String(item.quantity)} ${item.unit})`),
            kitchen_now: stock.success ? stock.data.map((entry) => entry.name) : [],
          },
        };
      }

      case 'removeFromStock': {
        const current = await StockItemModel.find({ ownerId }).exec();
        const missing: { name: string; reason: string }[] = [];
        let removed = 0;

        for (const name of call.toolPayload.names) {
          const found = current.find(
            (entry) => entry.name.toLowerCase() === name.toLowerCase(),
          );
          if (found === undefined) {
            missing.push({ name, reason: 'not in their kitchen' });
            continue;
          }
          const result = await stockService.remove(found._id, ownerId);
          if (result.success) removed += 1;
        }

        if (removed === 0) {
          return {
            ...base,
            result: 'failed',
            resultCode: RESULT_CODES.NOT_FOUND,
            error: 'None of those are in their kitchen.',
            partial: missing,
          };
        }

        const stock = await stockService.list(ownerId);
        return {
          ...base,
          result: 'success',
          resultCode: missing.length > 0 ? RESULT_CODES.NO_CHANGE : RESULT_CODES.OK,
          updatedData: { kitchen_now: stock.success ? stock.data.map((e) => e.name) : [] },
          ...(missing.length > 0 && { partial: missing }),
        };
      }

      case 'addToMarket': {
        const added: string[] = [];
        const failed: { name: string; reason: string }[] = [];

        for (const item of call.toolPayload.items) {
          const match = resolve(item.name);
          const result = await marketService.add(ownerId, {
            ...(match !== null && { catalogue_id: match.id }),
            name: match?.name ?? item.name,
            ...(item.quantity !== undefined && { quantity: item.quantity }),
            ...(item.unit !== undefined && { unit: item.unit }),
            ...(item.reason !== undefined && { reason: item.reason }),
          });
          if (result.success) added.push(match?.name ?? item.name);
          else failed.push({ name: item.name, reason: 'could not be added' });
        }

        if (added.length === 0) {
          return {
            ...base,
            result: 'failed',
            resultCode: RESULT_CODES.FAILED,
            error: 'Nothing could be added to the market list.',
            partial: failed,
          };
        }

        const list = await marketService.list(ownerId);
        return {
          ...base,
          result: 'success',
          resultCode: RESULT_CODES.OK,
          updatedData: {
            added,
            list_now: list.success ? list.data.items.map((item) => item.name) : [],
            estimated_total: list.success ? list.data.estimated_total : null,
          },
          ...(failed.length > 0 && { partial: failed }),
        };
      }

      case 'removeFromMarket': {
        const list = await marketService.list(ownerId);
        if (!list.success) {
          return { ...base, result: 'failed', resultCode: RESULT_CODES.FAILED, error: 'Could not read the market list.' };
        }

        const missing: { name: string; reason: string }[] = [];
        let removed = 0;

        for (const name of call.toolPayload.names) {
          const found = list.data.items.find(
            (item) => item.name.toLowerCase() === name.toLowerCase(),
          );
          if (found === undefined) {
            missing.push({ name, reason: 'not on their list' });
            continue;
          }
          const result = await marketService.remove(found.id, ownerId);
          if (result.success) removed += 1;
        }

        if (removed === 0) {
          return {
            ...base,
            result: 'failed',
            resultCode: RESULT_CODES.NOT_FOUND,
            error: 'None of those are on their market list.',
            partial: missing,
          };
        }

        const after = await marketService.list(ownerId);
        return {
          ...base,
          result: 'success',
          resultCode: RESULT_CODES.OK,
          updatedData: { list_now: after.success ? after.data.items.map((i) => i.name) : [] },
          ...(missing.length > 0 && { partial: missing }),
        };
      }

      case 'readStock': {
        const stock = await stockService.list(ownerId);
        return {
          ...base,
          result: 'success',
          resultCode: RESULT_CODES.OK,
          updatedData: {
            items: stock.success
              ? stock.data.map((item) => ({
                  name: item.name,
                  quantity: item.quantity,
                  unit: item.unit,
                  freshness: item.freshness,
                }))
              : [],
          },
        };
      }

      case 'readMarket': {
        const list = await marketService.list(ownerId);
        return {
          ...base,
          result: 'success',
          resultCode: RESULT_CODES.OK,
          updatedData: list.success
            ? {
                items: list.data.items.map((item) => ({ name: item.name, bought: item.bought })),
                estimated_total: list.data.estimated_total,
              }
            : { items: [] },
        };
      }

      case 'suggestMeals': {
        const suggestions = await mealsService.suggest(ownerId, call.toolPayload?.limit ?? 3);
        return {
          ...base,
          result: 'success',
          resultCode: RESULT_CODES.OK,
          updatedData: {
            meals: suggestions.success
              ? suggestions.data.map((entry) => ({
                  // The REAL id, from our database — this is what makes a meal
                  // in a reply openable rather than decorative.
                  mealId: entry.meal.id,
                  name: entry.meal.name,
                  match: entry.match_line,
                  missing: entry.missing,
                  cookTimeMinutes: entry.meal.cook_time_minutes,
                }))
              : [],
          },
        };
      }

      default: {
        return {
          ...base,
          result: 'failed',
          resultCode: RESULT_CODES.UNKNOWN_TOOL,
          error: 'That is not a tool this app has.',
        };
      }
    }
  } catch (error) {
    // A thrown tool must not take the conversation down — the model is told it
    // failed and can say so.
    const message = error instanceof Error ? error.message : String(error);
    logger.error('tool threw', { tool: call.tool, owner: ownerId, error: message });
    return { ...base, result: 'failed', resultCode: RESULT_CODES.FAILED, error: message };
  }
}
