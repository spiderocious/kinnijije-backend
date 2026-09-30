import type { z } from 'zod';

import { env } from '@app/env.js';
import { SERVER_EVENTS, analytics, estimateCostUsd } from '@lib/analytics/index.js';
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

    /**
     * The analytics event sits beside the log write, not inside the provider.
     *
     * Same reasoning the log row uses: at this layer it cannot be skipped by a
     * new provider, and it sees the call whatever answered it. Shape only —
     * tokens, duration, outcome. The prompt and the reply stay in `ai_logs`,
     * which is the forensic record; sending them here would leak user content
     * to a third party and blow past property size limits.
     */
    const imageCount = input.images?.length ?? 0;
    analytics.track(SERVER_EVENTS.AI_CALL_COMPLETED, input.ownerId ?? 'system', {
      prompt_id: input.promptId,
      provider: this.provider.name,
      model,
      tier: input.tier ?? 'large',
      ok,
      parsed: parsed !== null,
      duration_ms: durationMs,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimateCostUsd(model, promptTokens, completionTokens),
      had_images: imageCount > 0,
      image_count: imageCount,
      attempts,
    });

    if (!ok) {
      logger.warn('ai call did not produce a usable answer', {
        prompt_id: input.promptId,
        log_id: logId,
        error: callError ?? parseError,
      });

      // Separate from the completion event so a failure rate can be charted
      // without filtering, and so `failure_kind` can carry the distinction
      // that matters: a parse failure is a prompt bug we can fix, a provider
      // error is the vendor having a bad day.
      analytics.track(SERVER_EVENTS.AI_CALL_FAILED, input.ownerId ?? 'system', {
        prompt_id: input.promptId,
        model,
        failure_kind: callError !== null ? 'provider_error' : 'parse_failed',
        duration_ms: durationMs,
        attempts,
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
      analytics.track(SERVER_EVENTS.AI_TRANSCRIPTION_COMPLETED, ownerId ?? 'system', {
        model,
        duration_ms: Date.now() - started,
        // Billed by audio length, so this is the cost driver rather than a
        // curiosity. Bytes is the honest proxy available here.
        audio_bytes: audio.byteLength,
        text_length: text.length,
        ok: true,
      });
      return { ok: true, data: text, error: null, logId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      analytics.track(SERVER_EVENTS.AI_TRANSCRIPTION_COMPLETED, ownerId ?? 'system', {
        model: 'unknown',
        duration_ms: Date.now() - started,
        audio_bytes: audio.byteLength,
        text_length: 0,
        ok: false,
      });
      return { ok: false, data: null, error: message, logId: null };
    }
  }

  /**
   * Generates one picture.
   *
   * Logged in the same table as every other model call, so the console's AI
   * view answers "what did this cost" and "is this prompt any good" with no
   * new tooling. The prompt is stored verbatim: a good image must be
   * reproducible and a bad one diagnosable.
   */
  async generateImage(input: {
    prompt: string;
    ownerId?: string;
  }): Promise<AiCallResult<{ bytes: Uint8Array; contentType: string; model: string }>> {
    const started = Date.now();
    try {
      const image = await this.provider.generateImage(input.prompt);
      const logId = await this.record({
        promptId: 'image.generate',
        provider: this.provider.name,
        model: image.model,
        ownerId: input.ownerId ?? null,
        systemPrompt: '',
        userPrompt: input.prompt,
        imageRefs: [],
        rawResponse: `[image: ${String(image.bytes.byteLength)} bytes]`,
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
      // Tracked apart from text calls because it costs an order of magnitude
      // more — an image is worth roughly ten to forty text calls, so it must
      // not be averaged into them.
      analytics.track(SERVER_EVENTS.AI_IMAGE_GENERATED, input.ownerId ?? 'system', {
        model: image.model,
        duration_ms: Date.now() - started,
        bytes: image.bytes.byteLength,
        ok: true,
      });
      return { ok: true, data: image, error: null, logId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('image generation failed', { error: message });
      analytics.track(SERVER_EVENTS.AI_IMAGE_GENERATED, input.ownerId ?? 'system', {
        model: 'unknown',
        duration_ms: Date.now() - started,
        bytes: 0,
        ok: false,
      });
      const logId = await this.record({
        promptId: 'image.generate',
        provider: this.provider.name,
        model: 'unknown',
        ownerId: input.ownerId ?? null,
        systemPrompt: '',
        userPrompt: input.prompt,
        imageRefs: [],
        rawResponse: '',
        parsed: false,
        parseError: null,
        metrics: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        durationMs: Date.now() - started,
        ok: false,
        error: message,
      });
      return { ok: false, data: null, error: message, logId };
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
