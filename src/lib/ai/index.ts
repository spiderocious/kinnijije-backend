import type { z } from 'zod';

import { env } from '@app/env.js';
import { logger } from '@lib/logger/index.js';

import { AiLogModel } from './ai-log.model.js';
import { OpenAiProvider, type AiProvider } from './ai.provider.js';
import { mockProvider } from './mock.provider.js';
import { SYSTEM_PROMPTS, type PromptId } from './prompts.js';

/**
 * The AI facade. **Features import this and nothing else.**
 *
 *     feature → aiService → provider → SDK
 *
 * Three things happen here that must not be pushed down into a provider:
 *
 *   1. **Validation.** Every reply is parsed against a zod schema and REJECTED
 *      if it does not fit. A half-understood answer is worse than none.
 *   2. **Logging.** Every call is recorded — prompt, model, provider, tokens,
 *      raw reply, and whether it parsed. At this layer it cannot be skipped by
 *      a provider that forgets.
 *   3. **Provider choice.** So the whole product can run on canned answers.
 */

export interface AiCallResult<T> {
  readonly ok: boolean;
  readonly data: T | null;
  readonly error: string | null;
  /** Which log row this produced, for tracing a bad answer back. */
  readonly logId: string | null;
}

function chooseProvider(): AiProvider {
  const hasKey = env.OPENAI_API_KEY.length > 0;

  if (env.AI_PROVIDER === 'mock') return mockProvider;
  if (env.AI_PROVIDER === 'openai' && !hasKey) {
    logger.warn('AI_PROVIDER=openai but no key configured — using canned answers');
    return mockProvider;
  }
  if (env.AI_PROVIDER === 'openai') return new OpenAiProvider(env.OPENAI_API_KEY);

  return hasKey ? new OpenAiProvider(env.OPENAI_API_KEY) : mockProvider;
}

class AiService {
  private readonly provider: AiProvider;

  private constructor() {
    this.provider = chooseProvider();

    /**
     * Loud about which provider won, and why.
     *
     * A silent fallback to canned answers is how somebody spends an afternoon
     * wondering why the model "is smoking" when it never ran at all — so this
     * says the key length (never the key) and the models it will use.
     */
    logger.info('ai provider selected', {
      provider: this.provider.name,
      configured: env.AI_PROVIDER,
      key_present: env.OPENAI_API_KEY.length > 0,
      key_length: env.OPENAI_API_KEY.length,
      generate_model: env.OPENAI_GENERATE_MODEL,
      parse_model: env.OPENAI_PARSE_MODEL,
      vision_model: env.OPENAI_VISION_MODEL,
    });

    if (this.provider.name === 'mock') {
      logger.warn(
        'AI IS RUNNING ON CANNED ANSWERS — nothing is sent to a model. Set OPENAI_API_KEY and AI_PROVIDER=openai (or auto) to use the real one.',
      );
    }
  }

  private static instance: AiService | undefined;

  static getInstance(): AiService {
    AiService.instance ??= new AiService();
    return AiService.instance;
  }

  get providerName(): string {
    return this.provider.name;
  }

  get isMocked(): boolean {
    return this.provider.name === 'mock';
  }

  /**
   * One structured call: prompt in, validated object out, everything logged.
   *
   * A failure here is always RETURNED, never thrown. A model outage must
   * degrade the feature that asked rather than take down the request.
   */
  async call<TSchema extends z.ZodTypeAny>(input: {
    promptId: PromptId;
    schema: TSchema;
    userPrompt: string;
    ownerId?: string;
    images?: { base64: string; contentType: string }[];
    imageRefs?: string[];
    tier?: 'small' | 'large';
  }): Promise<AiCallResult<z.infer<TSchema>>> {
    const systemPrompt = SYSTEM_PROMPTS[input.promptId];
    const started = Date.now();
    /** Carried between attempts so the retry can quote what was wrong. */
    let parseErrorForRetry: string | null = null;

    let raw = '';
    let model = 'unknown';
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let totalTokens: number | null = null;
    let callError: string | null = null;
    let parsed: z.infer<TSchema> | null = null;
    let parseError: string | null = null;
    let attempts = 0;

    /**
     * One shape mistake must not cost the person their answer.
     *
     * A model that returns a good answer in the wrong shape — nesting it under
     * its own `kind`, or omitting an envelope key — is not a model that cannot
     * do the job. It is one that misread the contract, and telling it exactly
     * which field was wrong fixes it almost every time. Two attempts, then we
     * genuinely give up: retrying a model that is confidently wrong twice just
     * spends money.
     */
    const MAX_ATTEMPTS = 2;

    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      callError = null;
      parseError = null;

      // The second attempt says what was wrong with the first, quoting zod.
      const correction =
        attempts === 1
          ? ''
          : `\n\nYOUR LAST ANSWER WAS REJECTED. It did not match the required shape:\n  ${String(parseErrorForRetry)}\nReturn the SAME information, in the exact shape described. Every required key at the TOP level, no wrapper object.`;

      try {
        const output = await this.provider.complete({
          systemPrompt,
          // The marker lets the mock provider find its canned file without the
          // raw provider interface having to know about prompt ids at all.
          userPrompt: `[[prompt:${input.promptId}]]\n${input.userPrompt}${correction}`,
          ...(input.images !== undefined && { images: input.images }),
          tier: input.tier ?? 'large',
        });
        raw = output.text;
        model = output.model;
        promptTokens = output.promptTokens;
        completionTokens = output.completionTokens;
        totalTokens = output.totalTokens;
      } catch (error) {
        callError = error instanceof Error ? error.message : String(error);
        // A transport failure is not a shape problem; re-asking will not help.
        break;
      }

      try {
        // Models wrap JSON in ``` fences despite being told not to. Strip
        // rather than fail — the content is right, the packaging is not.
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const result = input.schema.safeParse(JSON.parse(cleaned));

        if (result.success) {
          parsed = result.data as z.infer<TSchema>;
          break;
        }

        // The whole point: a reply that does not fit is rejected, not
        // salvaged. Salvaging is how malformed data reaches a person's
        // kitchen looking authoritative. But it IS worth asking again.
        parseError = result.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
      } catch (error) {
        parseError = `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
      }

      parseErrorForRetry = parseError;
      if (attempts < MAX_ATTEMPTS) {
        logger.warn('ai answer did not fit the schema — asking again', {
          prompt_id: input.promptId,
          attempt: attempts,
          error: parseError,
        });
      }
    }

    const durationMs = Date.now() - started;
    const ok = callError === null && parseError === null;

    // Logged whatever happened — a failed call is the most useful row there is.
    const logId = await this.record({
      promptId: input.promptId,
      provider: this.provider.name,
      model,
      ownerId: input.ownerId ?? null,
      systemPrompt,
      userPrompt: input.userPrompt,
      imageRefs: input.imageRefs ?? [],
      rawResponse: raw.length > 0 ? raw : null,
      parsed: parsed !== null,
      parseError,
      metrics: extractMetrics(parsed),
      promptTokens,
      completionTokens,
      totalTokens,
      durationMs,
      ok,
      error: callError ?? parseError,
    });

    if (!ok) {
      logger.warn('ai call did not produce a usable answer', {
        prompt_id: input.promptId,
        log_id: logId,
        error: callError ?? parseError,
      });
    }

    return { ok, data: parsed, error: callError ?? parseError, logId };
  }

  async transcribe(
    audio: Buffer,
    filename: string,
    ownerId?: string,
  ): Promise<AiCallResult<string>> {
    const started = Date.now();
    try {
      const { text, model } = await this.provider.transcribe(audio, filename);
      const logId = await this.record({
        promptId: 'audio.transcribe',
        provider: this.provider.name,
        model,
        ownerId: ownerId ?? null,
        systemPrompt: SYSTEM_PROMPTS['audio.transcribe'],
        userPrompt: `[audio: ${filename}]`,
        imageRefs: [],
        rawResponse: text,
        parsed: true,
        parseError: null,
        metrics: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        durationMs: Date.now() - started,
        ok: true,
        error: null,
      });
      return { ok: true, data: text, error: null, logId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, data: null, error: message, logId: null };
    }
  }

  /** Logging must never be the reason a feature fails. */
  private async record(row: Parameters<typeof AiLogModel.create>[0]): Promise<string | null> {
    try {
      const doc = await AiLogModel.create(row);
      return doc._id;
    } catch (error) {
      logger.error('failed to record ai call', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

/** Pulls the self-graded metrics off a parsed reply, if it carried any. */
function extractMetrics(parsed: unknown): Record<string, unknown> | null {
  if (parsed === null || typeof parsed !== 'object') return null;
  const metrics = (parsed as { metrics?: unknown }).metrics;
  return metrics !== null && typeof metrics === 'object'
    ? (metrics as Record<string, unknown>)
    : null;
}

export const aiService = AiService.getInstance();

export { PROMPT_IDS, ALL_PROMPT_IDS, SYSTEM_PROMPTS, type PromptId } from './prompts.js';
export * from './ai.contracts.js';
