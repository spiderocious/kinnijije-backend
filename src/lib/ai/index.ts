import { env } from '@app/env.js';
import { mockAiProvider } from '@features/mock/index.js';
import { logger } from '@lib/logger/index.js';

import type { AiProvider, AiResult, ChatAnswer, GeneratedRecipe } from './ai.types.js';
import { OpenAiProvider } from './openai.provider.js';
import { PROMPT_IDS } from './prompts.js';

/**
 * The AI facade. **Features import this and nothing else.**
 *
 *     feature → aiService → openAiProvider → OpenAI SDK
 *                        ↘ mockAiProvider  → canned JSON
 *
 * Two things fall out of the indirection:
 *
 *  - A demo can be made fully deterministic with one env change, because the
 *    mock answers the same call the same way every time.
 *  - Nothing downstream knows which provider ran, except through `meta.provider`
 *    on the result — which is reported honestly so canned data is never
 *    mistaken for a real read.
 */
function chooseProvider(): AiProvider {
  const hasKey = env.OPENAI_API_KEY.length > 0;

  if (env.AI_PROVIDER === 'mock') return mockAiProvider;
  if (env.AI_PROVIDER === 'openai') {
    if (!hasKey) {
      // Refusing to start would be worse: the rest of the app works fine
      // without AI, and a loud warning plus deterministic answers beats a
      // boot failure on a machine that was only ever going to run the UI.
      logger.warn('AI_PROVIDER=openai but OPENAI_API_KEY is empty — falling back to mock');
      return mockAiProvider;
    }
    return new OpenAiProvider(env.OPENAI_API_KEY);
  }

  // 'auto': real when a key exists, canned otherwise.
  return hasKey ? new OpenAiProvider(env.OPENAI_API_KEY) : mockAiProvider;
}

class AiService {
  private readonly provider: AiProvider;

  private constructor() {
    this.provider = chooseProvider();
    logger.info('ai provider selected', {
      provider: this.provider.name,
      configured: env.AI_PROVIDER,
    });
  }

  private static instance: AiService | undefined;

  static getInstance(): AiService {
    AiService.instance ??= new AiService();
    return AiService.instance;
  }

  get providerName(): 'openai' | 'mock' {
    return this.provider.name;
  }

  /** True when answers are canned. The UI should say so rather than imply a real read. */
  get isMocked(): boolean {
    return this.provider.name === 'mock';
  }

  extractIngredientsFromPhotos(
    images: { base64: string; contentType: string }[],
  ): Promise<AiResult<string[]>> {
    return this.provider.extractIngredientsFromImages({
      promptId: PROMPT_IDS.INGREDIENTS_EXTRACT_PHOTO,
      images,
    });
  }

  extractIngredientsFromReceipt(
    images: { base64: string; contentType: string }[],
  ): Promise<AiResult<string[]>> {
    return this.provider.extractIngredientsFromImages({
      promptId: PROMPT_IDS.INGREDIENTS_EXTRACT_RECEIPT,
      images,
    });
  }

  parseIngredientsFromText(text: string): Promise<AiResult<string[]>> {
    return this.provider.parseIngredientsFromText({
      promptId: PROMPT_IDS.INGREDIENTS_PARSE_TEXT,
      text,
    });
  }

  parseIngredientsFromSpeech(transcript: string): Promise<AiResult<string[]>> {
    return this.provider.parseIngredientsFromText({
      promptId: PROMPT_IDS.INGREDIENTS_PARSE_VOICE,
      text: transcript,
    });
  }

  transcribeAudio(audio: Buffer, filename: string): Promise<AiResult<string>> {
    return this.provider.transcribeAudio({ audio, filename });
  }

  generateRecipe(input: {
    ingredients: string[];
    cuisines: string[];
    difficulty: string;
  }): Promise<AiResult<GeneratedRecipe>> {
    return this.provider.generateRecipe(input);
  }

  answerQuestion(input: {
    question: string;
    kitchenContext: string[];
  }): Promise<AiResult<ChatAnswer>> {
    return this.provider.answerQuestion(input);
  }
}

export const aiService = AiService.getInstance();

export type { AiProvider, AiResult, ChatAnswer, GeneratedRecipe } from './ai.types.js';
export { PROMPT_IDS, ALL_PROMPT_IDS, type PromptId } from './prompts.js';
