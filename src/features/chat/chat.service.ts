import { MealModel } from '@features/meals/meals.model.js';
import { aiService, ChatReplySchema, PROMPT_IDS } from '@lib/ai/index.js';
import { logger } from '@lib/logger/index.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import { buildChatContext, renderContext } from './chat.context.js';
import { ChatMessageModel } from './chat.model.js';
import type { ToolResult } from './chat.tool-contracts.js';
import { executeToolCalls } from './chat.tools.js';

export interface ChatMealView {
  meal_id: string | null;
  name: string;
  why: string;
  cook_time_minutes: number | null;
  difficulty: string | null;
  have: string[];
  missing: string[];
  /**
   * True only when the meal really exists here. The interface uses this to
   * decide whether "Start cooking" is offered — an AI-invented dish has no
   * steps to follow, so offering to cook it would be a dead end.
   */
  is_ours: boolean;
}

export interface ChatReplyView {
  id: string;
  kind: string;
  text: string;
  meals: ChatMealView[];
  source: string;
  citations: string[];
  notes: unknown;
  /** What was actually carried out, for the interface to show as receipts. */
  tool_results: ToolResult[];
  created_at: string;
}

export class ChatService {
  private static instance: ChatService | undefined;

  static getInstance(): ChatService {
    ChatService.instance ??= new ChatService();
    return ChatService.instance;
  }

  async history(ownerId: string, limit = 30): Promise<ServiceResult<unknown[]>> {
    const messages = await ChatMessageModel.find({ ownerId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    // Reversed so the interface renders oldest-first without re-sorting.
    return ok(
      messages.reverse().map((m) => ({
        id: m._id,
        role: m.role,
        text: m.text,
        payload: m.payload,
        mocked: m.mocked,
        created_at: m.createdAt.toISOString(),
      })),
    );
  }

  /**
   * Asks a question, with the cook's whole situation prepended.
   *
   * The reply is validated against a strict schema before anything is stored or
   * shown — a model that ignores the contract produces nothing rather than
   * half-rendered nonsense.
   */
  /**
   * One turn of conversation, which may take TWO passes at the model.
   *
   *   1. the model answers, and may emit tool calls
   *   2. we run them and hand the RESULTS back
   *   3. the model answers again, knowing what actually happened
   *
   * The person sees that second answer. The first is scaffolding — showing it
   * would mean showing "I have added rice" before we know whether that worked.
   */
  async ask(ownerId: string, question: string): Promise<ServiceResult<ChatReplyView>> {
    // Stamped with WHICH brain answered, so a canned reply is never mistaken
    // later for something a real model said.
    const mocked = aiService.isMocked;

    await ChatMessageModel.create({ ownerId, role: 'user', text: question, payload: null, mocked });

    const context = await buildChatContext(ownerId);
    const contextBlock = renderContext(context);

    const first = await aiService.call({
      promptId: PROMPT_IDS.CHAT_ANSWER,
      schema: ChatReplySchema,
      userPrompt: `${contextBlock}\n\n---\nTHEIR QUESTION: ${question}`,
      ownerId,
      tier: 'large',
    });

    if (!first.ok || first.data === null) {
      logger.warn('chat reply rejected', { owner: ownerId, error: first.error });
      return fail(
        ERROR_CODES.UPSTREAM_FAILURE,
        MESSAGE_KEYS.chat.FAILED,
        HTTP_STATUS.UNAVAILABLE,
        { rejectionReason: 'ai_reply_invalid' },
      );
    }

    let reply = first.data;
    let toolResults: ToolResult[] = [];

    // The model asked for something. Run it, then let it speak again with the
    // outcome in hand.
    if (reply.toolCalls !== undefined && reply.toolCalls.length > 0) {
      toolResults = await executeToolCalls(ownerId, reply.toolCalls);

      // The kitchen may have just changed, so the second pass gets a FRESH
      // context — otherwise the model describes the state from before its own
      // actions.
      const afterContext = renderContext(await buildChatContext(ownerId));

      const second = await aiService.call({
        promptId: PROMPT_IDS.CHAT_ANSWER,
        schema: ChatReplySchema,
        userPrompt: [
          afterContext,
          '',
          '---',
          `THEIR QUESTION: ${question}`,
          '',
          'YOU ASKED FOR THESE ACTIONS AND THIS IS WHAT HAPPENED:',
          JSON.stringify(toolResults, null, 2),
          '',
          'Tell them plainly what was done. Anything with result "failed" did NOT happen —',
          'say so and why, do not claim it worked. Do NOT emit toolCalls again;',
          'the work is finished.',
        ].join('\n'),
        ownerId,
        tier: 'large',
      });

      // A failed second pass is recoverable: the actions already ran, so the
      // outcome is reported from the results rather than lost.
      if (second.ok && second.data !== null) {
        reply = second.data;
      } else {
        reply = {
          ...reply,
          text: summariseResults(toolResults),
          toolCalls: undefined,
        };
      }
    }

    const meals = await this.verifyMeals(reply.meals ?? []);

    const stored = await ChatMessageModel.create({
      ownerId,
      role: 'assistant',
      text: reply.text,
      mocked,
      payload: {
        kind: reply.kind,
        meals,
        source: reply.source,
        citations: reply.citations,
        tool_results: toolResults,
      },
    });

    return ok({
      id: stored._id,
      kind: reply.kind,
      text: reply.text,
      meals,
      source: reply.source,
      citations: reply.citations,
      notes: reply.notes,
      tool_results: toolResults,
      created_at: stored.createdAt.toISOString(),
    });
  }

  /**
   * Every meal id the model returned, checked against the database.
   *
   * A hallucinated id would send somebody to a recipe that does not exist, so
   * anything unverifiable is downgraded to "the model invented this" rather
   * than trusted.
   */
  private async verifyMeals(
    claimed: readonly {
      mealId: string | null;
      name: string;
      why: string;
      cookTimeMinutes: number | null;
      difficulty: 'easy' | 'medium' | 'involved' | null;
      have: string[];
      missing: string[];
    }[],
  ): Promise<ChatMealView[]> {
    const ids = claimed.map((m) => m.mealId).filter((id): id is string => id !== null);
    const real =
      ids.length > 0
        ? await MealModel.find({ _id: { $in: ids }, status: 'published' }).select('_id').exec()
        : [];
    const realIds = new Set(real.map((m) => m._id));

    return claimed.map((m) => {
      const isOurs = m.mealId !== null && realIds.has(m.mealId);
      return {
        meal_id: isOurs ? m.mealId : null,
        name: m.name,
        why: m.why,
        cook_time_minutes: m.cookTimeMinutes,
        difficulty: m.difficulty,
        have: m.have,
        missing: m.missing,
        is_ours: isOurs,
      };
    });
  }

  async clear(ownerId: string): Promise<ServiceResult<null>> {
    await ChatMessageModel.deleteMany({ ownerId }).exec();
    return ok(null);
  }
}

export const chatService = ChatService.getInstance();

/**
 * A plain summary, used only when the model fails to speak a second time.
 *
 * The actions already ran at that point, so saying nothing would leave someone
 * wondering whether their kitchen changed.
 */
function summariseResults(results: readonly ToolResult[]): string {
  const done = results.filter((r) => r.result === 'success').length;
  const failed = results.filter((r) => r.result === 'failed');

  if (failed.length === 0) {
    return `Done — ${String(done)} action${done === 1 ? '' : 's'} carried out.`;
  }
  if (done === 0) {
    return `That did not work: ${failed.map((r) => r.error ?? r.tool).join('; ')}`;
  }
  return `Partly done. ${String(done)} worked; ${failed.map((r) => r.error ?? r.tool).join('; ')}`;
}
