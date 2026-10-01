import { env } from '@app/env.js';
import { logger } from '@lib/logger/index.js';

import { aiService } from './index.js';

/**
 * Transcription, behind a registry.
 *
 * Separate from `AiProvider` even though the OpenAI one implements both: the
 * best model for speech is not the best model for text, and the whole point of
 * naming them apart is being able to swap one without touching the other. A
 * Deepgram or a Groq implementation drops in here without any caller changing.
 *
 * Every provider's calls land in `ai_logs` through `aiService.transcribe()`, so
 * the console can compare duration and failure rate per provider — which is the
 * only honest basis for choosing one.
 */

export interface TranscriptionResult {
  text: string;
  provider: string;
  model: string;
  durationMs: number;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(audio: Buffer, filename: string, ownerId?: string): Promise<TranscriptionResult>;
}

/**
 * The one that exists today.
 *
 * Delegates to `aiService.transcribe()` rather than the raw provider, because
 * that wrapper is what writes the `ai_logs` row — bypassing it would make this
 * provider invisible in the console, which defeats the comparison.
 */
const openAiWhisper: TranscriptionProvider = {
  name: 'openai-whisper',
  async transcribe(audio, filename, ownerId) {
    const started = Date.now();
    const result = await aiService.transcribe(audio, filename, ownerId);
    if (!result.ok || result.data === null) {
      throw new Error(result.error ?? 'transcription failed');
    }
    return {
      text: result.data,
      provider: 'openai-whisper',
      model: env.OPENAI_WHISPER_MODEL,
      durationMs: Date.now() - started,
    };
  },
};

/**
 * Fixed text, for tests and for a machine with no OpenAI key.
 *
 * Deliberately a sentence the parser can actually read: a mock that returns
 * "lorem ipsum" proves the pipe is connected and nothing else.
 */
const mockTranscription: TranscriptionProvider = {
  name: 'mock',
  transcribe(_audio, _filename) {
    return Promise.resolve({
      text: 'I have rice and eggs, I am tired, about twenty minutes, no pepper please',
      provider: 'mock',
      model: 'mock-whisper',
      durationMs: 5,
    });
  },
};

const REGISTRY: Readonly<Record<string, TranscriptionProvider>> = {
  'openai-whisper': openAiWhisper,
  mock: mockTranscription,
};

/**
 * Which provider answers.
 *
 * Falls back to the mock rather than throwing when the configured name is
 * unknown: a typo in an env var should degrade the feature, not take the
 * process down at boot.
 */
export function transcriptionProvider(name?: string): TranscriptionProvider {
  const wanted = name ?? env.TRANSCRIPTION_PROVIDER;
  const found = REGISTRY[wanted];
  if (found !== undefined) return found;

  logger.warn('unknown transcription provider, using mock', { wanted });
  return mockTranscription;
}

/** Every registered name, for the console's provider comparison. */
export const TRANSCRIPTION_PROVIDERS = Object.keys(REGISTRY);
