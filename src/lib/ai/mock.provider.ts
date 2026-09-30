import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from '@lib/logger/index.js';

import type { AiProvider, RawCallInput, RawCallOutput, RawImageOutput } from './ai.provider.js';

/**
 * Canned answers, keyed by prompt id.
 *
 * The point is a demo that is DETERMINISTIC — the same input gives the same
 * output, instantly, with no network and no spend. That makes a walkthrough
 * repeatable and lets the whole interface be built before the real prompts are
 * tuned.
 *
 * The canned data is deliberately shaped to PASS the same zod schemas the real
 * provider's output must pass. Mock data that skips validation would let a
 * contract drift without anyone noticing until it hit a real model.
 */
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'mock-data');

const cache = new Map<string, string>();

function loadCanned(promptId: string): string | null {
  const cached = cache.get(promptId);
  if (cached !== undefined) return cached;

  try {
    const raw = readFileSync(join(DATA_DIR, `${promptId}.json`), 'utf8');
    cache.set(promptId, raw);
    return raw;
  } catch {
    logger.warn('no canned answer for prompt', { prompt_id: promptId });
    return null;
  }
}

/**
 * Which prompt a call belongs to, worked out from its system prompt.
 *
 * The raw provider interface takes prompts, not ids — that is what keeps it
 * ignorant of our domain. The mock needs the id to find its file, so it is
 * carried in the user prompt as a marker the service adds.
 */
function promptIdFrom(userPrompt: string): string | null {
  const match = /\[\[prompt:([a-z._]+)\]\]/.exec(userPrompt);
  return match?.[1] ?? null;
}

/**
 * Lets a canned answer name something from the prompt it was given.
 *
 * `decide.verdict` must return an id we actually sent, and a fixed id in a
 * JSON file can never be one. Rather than special-casing the whole prompt, the
 * canned file carries the marker `__FIRST__` and it is replaced with the first
 * id the prompt offered — so the mock exercises the REAL success path instead
 * of always tripping the validation fallback, which would leave that path
 * untested until it met a live model.
 */
function substituteIds(canned: string, userPrompt: string): string {
  if (!canned.includes('__FIRST__')) return canned;
  const firstId = /\bid:\s*([A-Za-z0-9_-]+)/.exec(userPrompt)?.[1];
  return canned.replace('__FIRST__', firstId ?? 'unknown');
}

export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  complete(input: RawCallInput): Promise<RawCallOutput> {
    // The canned answers cannot look at an image, so a mocked photo check must
    // NOT claim a verdict about one — it would tell somebody their selfie is a
    // shelf full of rice. It answers honestly that it could not look.
    if (promptIdFrom(input.userPrompt) === 'photo.verdict') {
      return Promise.resolve({
        text: JSON.stringify({
          verdict: 'unreadable',
          usable: false,
          reason: 'AI is switched off, so photos cannot be checked. Set OPENAI_API_KEY to read them.',
          notes: {
            warnings: ['Running on canned answers — no image was actually looked at.'],
          },
          metrics: {
            outputLevel: 'refused',
            outputConfidence: 0,
            clarity: 0,
            ambiguity: 1,
            tuneSuggestion: 'none',
          },
        }),
        model: 'mock-deterministic',
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      });
    }

    const promptId = promptIdFrom(input.userPrompt);
    const canned = promptId === null ? null : loadCanned(promptId);

    if (canned === null) {
      // Returning something unparseable is CORRECT here: a missing canned
      // answer should surface as a loud validation failure, not as silence
      // that looks like a working feature.
      return Promise.resolve({
        text: JSON.stringify({ error: `no mock data for ${promptId ?? 'unknown prompt'}` }),
        model: 'mock-deterministic',
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      });
    }

    return Promise.resolve({
      text: substituteIds(canned, input.userPrompt),
      model: 'mock-deterministic',
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  }

  /**
   * A real, decodable 1x1 PNG.
   *
   * Not an empty buffer and not a thrown error: the derive step downstream has
   * to actually read these bytes, so a mock that cannot be decoded would make
   * the whole pipeline untestable without a live key. It is deliberately
   * obvious rather than a plausible photograph — nobody should mistake a
   * mocked image for a real one.
   */
  generateImage(_prompt: string): Promise<RawImageOutput> {
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    return Promise.resolve({
      bytes: onePixelPng,
      contentType: 'image/png',
      model: 'mock-deterministic',
    });
  }

  transcribe(_audio: Buffer, _filename: string): Promise<{ text: string; model: string }> {
    return Promise.resolve({
      text: 'I have rice, some tomatoes, two onions, atarodo and a bit of chicken in the freezer.',
      model: 'mock-deterministic',
    });
  }
}

export const mockProvider = new MockAiProvider();
