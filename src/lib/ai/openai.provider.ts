import OpenAI from 'openai';

import { env } from '@app/env.js';
import { logger } from '@lib/logger/index.js';

import type {
  AiProvider,
  AiResult,
  ChatAnswer,
  GeneratedRecipe,
} from './ai.types.js';
import { PROMPT_IDS, SYSTEM_PROMPTS, type PromptId } from './prompts.js';

/**
 * The only file in the codebase that imports the OpenAI SDK.
 *
 * Features talk to `aiService`, never to this — which is what lets the whole
 * product run off canned data with one env change, and what makes swapping
 * provider a single-file job.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;

  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async extractIngredientsFromImages(input: {
    promptId: PromptId;
    images: { base64: string; contentType: string }[];
  }): Promise<AiResult<string[]>> {
    const started = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: env.OPENAI_VISION_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[input.promptId] },
          {
            role: 'user',
            content: input.images.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: `data:${image.contentType};base64,${image.base64}` },
            })),
          },
        ],
        response_format: { type: 'json_object' },
      });

      const items = parseStringArray(response.choices[0]?.message.content);
      return this.done(input.promptId, env.OPENAI_VISION_MODEL, started, items, response.usage?.total_tokens);
    } catch (error) {
      return this.failed(input.promptId, env.OPENAI_VISION_MODEL, started, error);
    }
  }

  async parseIngredientsFromText(input: {
    promptId: PromptId;
    text: string;
  }): Promise<AiResult<string[]>> {
    const started = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[input.promptId] },
          { role: 'user', content: input.text },
        ],
        response_format: { type: 'json_object' },
      });

      const items = parseStringArray(response.choices[0]?.message.content);
      return this.done(input.promptId, env.OPENAI_MODEL, started, items, response.usage?.total_tokens);
    } catch (error) {
      return this.failed(input.promptId, env.OPENAI_MODEL, started, error);
    }
  }

  async transcribeAudio(input: { audio: Buffer; filename: string }): Promise<AiResult<string>> {
    const started = Date.now();
    const id = PROMPT_IDS.AUDIO_TRANSCRIBE;
    try {
      const response = await this.client.audio.transcriptions.create({
        model: env.OPENAI_TRANSCRIBE_MODEL,
        file: new File([new Uint8Array(input.audio)], input.filename),
      });
      return this.done(id, env.OPENAI_TRANSCRIBE_MODEL, started, response.text, undefined);
    } catch (error) {
      return this.failed(id, env.OPENAI_TRANSCRIBE_MODEL, started, error);
    }
  }

  async generateRecipe(input: {
    ingredients: string[];
    cuisines: string[];
    difficulty: string;
  }): Promise<AiResult<GeneratedRecipe>> {
    const started = Date.now();
    const id = PROMPT_IDS.RECIPE_GENERATE;
    try {
      const response = await this.client.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[id] },
          {
            role: 'user',
            content: JSON.stringify({
              have: input.ingredients,
              prefer_cuisines: input.cuisines,
              difficulty: input.difficulty,
              shape: {
                name: 'string',
                cuisines: ['string'],
                difficulty: 'easy | medium | involved',
                cook_time_minutes: 'number',
                serves: 'number',
                ingredients: [{ name: 'string', quantity: 'string', approximate: true }],
                steps: [{ index: 1, heading: 'string', description: 'string', est_minutes: 0 }],
              },
            }),
          },
        ],
        response_format: { type: 'json_object' },
      });

      const raw: unknown = JSON.parse(response.choices[0]?.message.content ?? '{}');
      return this.done(id, env.OPENAI_MODEL, started, raw as GeneratedRecipe, response.usage?.total_tokens);
    } catch (error) {
      return this.failed(id, env.OPENAI_MODEL, started, error);
    }
  }

  async answerQuestion(input: {
    question: string;
    kitchenContext: string[];
  }): Promise<AiResult<ChatAnswer>> {
    const started = Date.now();
    const id = PROMPT_IDS.CHAT_ANSWER;
    try {
      const response = await this.client.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[id] },
          {
            role: 'user',
            content: JSON.stringify({
              question: input.question,
              kitchen: input.kitchenContext,
              shape: { answer: 'string', citations: ['string'], source: 'kitchen | recipe | general' },
            }),
          },
        ],
        response_format: { type: 'json_object' },
      });

      const raw: unknown = JSON.parse(response.choices[0]?.message.content ?? '{}');
      return this.done(id, env.OPENAI_MODEL, started, raw as ChatAnswer, response.usage?.total_tokens);
    } catch (error) {
      return this.failed(id, env.OPENAI_MODEL, started, error);
    }
  }

  private done<T>(
    promptId: PromptId,
    model: string,
    startedAt: number,
    data: T,
    tokens: number | undefined,
  ): AiResult<T> {
    return {
      ok: true,
      data,
      meta: {
        prompt_id: promptId,
        provider: 'openai',
        model,
        duration_ms: Date.now() - startedAt,
        tokens_used: tokens ?? null,
      },
    };
  }

  /**
   * An upstream failure is RETURNED, never thrown. A model outage must degrade
   * the feature that asked, not take down the request.
   */
  private failed<T>(
    promptId: PromptId,
    model: string,
    startedAt: number,
    error: unknown,
  ): AiResult<T> {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error('openai call failed', { prompt_id: promptId, model, error: reason });
    return {
      ok: false,
      reason,
      meta: {
        prompt_id: promptId,
        provider: 'openai',
        model,
        duration_ms: Date.now() - startedAt,
        tokens_used: null,
      },
    };
  }
}

/** The model is told to return JSON, but it is still untrusted input. */
function parseStringArray(content: string | null | undefined): string[] {
  if (content === null || content === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    if (parsed !== null && typeof parsed === 'object') {
      // Asking for a JSON object commonly yields { items: [...] } or similar;
      // take the first array-of-strings property rather than guessing the key.
      for (const value of Object.values(parsed)) {
        if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
      }
    }
    return [];
  } catch {
    return [];
  }
}
