import OpenAI from 'openai';

import { env } from '@app/env.js';

/**
 * A raw model call. Knows nothing about our schemas, our logging, or our
 * features — it takes prompts and returns text.
 *
 * The only file that imports the OpenAI SDK.
 */
export interface RawCallInput {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly images?: { base64: string; contentType: string }[];
  /** Small and fast for cheap checks; the bigger one for generation. */
  readonly tier: 'small' | 'large';
  /**
   * Sampling temperature. Omitted means the extraction default below.
   *
   * Set it only for prompts that WRITE something — a rundown, a framing line.
   * For reading a receipt, creativity is a bug.
   */
  readonly temperature?: number;
}

export interface RawCallOutput {
  readonly text: string;
  readonly model: string;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
}

/** A generated picture, as bytes. Never a URL — those expire. */
export interface RawImageOutput {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly model: string;
}

export interface AiProvider {
  readonly name: string;
  complete(input: RawCallInput): Promise<RawCallOutput>;
  transcribe(audio: Buffer, filename: string): Promise<{ text: string; model: string }>;
  /**
   * Generates one picture.
   *
   * Deliberately separate from `complete`: it returns bytes rather than text,
   * costs an order of magnitude more, and is only ever called from a
   * background job — never from a request path.
   */
  generateImage(prompt: string): Promise<RawImageOutput>;
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(input: RawCallInput): Promise<RawCallOutput> {
    /**
     * The photo gatekeeper runs on every image a person picks; using the
     * expensive model there would cost more than the extraction it guards.
     *
     * Vision gets its own setting because reading a shelf photo genuinely
     * needs a stronger model than parsing a sentence does.
     */
    const hasImages = (input.images?.length ?? 0) > 0;
    const model =
      input.tier === 'small'
        ? env.OPENAI_PARSE_MODEL
        : hasImages
          ? env.OPENAI_VISION_MODEL
          : env.OPENAI_GENERATE_MODEL;

    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: input.userPrompt },
      ...(input.images ?? []).map(
        (image): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
          type: 'image_url',
          image_url: { url: `data:${image.contentType};base64,${image.base64}` },
        }),
      ),
    ];

    const response = await this.client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content },
      ],
      // Forces syntactically valid JSON. It does NOT guarantee our shape —
      // that is what the zod pass afterwards is for.
      response_format: { type: 'json_object' },
      // Low but not zero: these are extraction tasks, where creativity is a
      // bug. A prose prompt overrides it — see RawCallInput.temperature.
      temperature: input.temperature ?? 0.2,
    });

    return {
      text: response.choices[0]?.message.content ?? '',
      model,
      promptTokens: response.usage?.prompt_tokens ?? null,
      completionTokens: response.usage?.completion_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
    };
  }

  async transcribe(audio: Buffer, filename: string): Promise<{ text: string; model: string }> {
    const response = await this.client.audio.transcriptions.create({
      model: env.OPENAI_WHISPER_MODEL,
      file: new File([new Uint8Array(audio)], filename),
    });
    return { text: response.text, model: env.OPENAI_WHISPER_MODEL };
  }

  async generateImage(prompt: string): Promise<RawImageOutput> {
    const response = await this.client.images.generate({
      model: env.OPENAI_IMAGE_MODEL,
      prompt,
      size: '1024x1024',
      n: 1,
    });

    // Asked for as base64 rather than a URL: a generated URL expires, and this
    // runs in a worker that must write the bytes to storage itself.
    const encoded = response.data?.[0]?.b64_json;
    if (encoded === undefined) throw new Error('image model returned no image data');

    return {
      bytes: Buffer.from(encoded, 'base64'),
      contentType: 'image/png',
      model: env.OPENAI_IMAGE_MODEL,
    };
  }
}
