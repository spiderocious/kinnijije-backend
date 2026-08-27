import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from '@lib/logger/index.js';
import type {
  AiProvider,
  AiResult,
  ChatAnswer,
  GeneratedRecipe,
} from '@lib/ai/ai.types.js';
import { PROMPT_IDS, type PromptId } from '@lib/ai/prompts.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');

interface MockFile<T> {
  promptId: string;
  description: string;
  default: T;
  scenarios?: Record<string, T>;
}

/**
 * Canned answers, keyed by prompt id.
 *
 * The point is a demo that is **deterministic** — the same input always gives
 * the same output, instantly, with no network and no spend. That makes a
 * walkthrough repeatable, and it makes the frontend buildable before the real
 * prompts are tuned.
 *
 * Files are read once and held: they are small, they do not change at runtime,
 * and re-reading per call would put disk I/O in a hot path for no gain.
 */
const cache = new Map<string, unknown>();

function load<T>(promptId: PromptId): MockFile<T> | null {
  const cached = cache.get(promptId);
  if (cached !== undefined) return cached as MockFile<T>;

  try {
    const raw = readFileSync(join(DATA_DIR, `${promptId}.json`), 'utf8');
    const parsed = JSON.parse(raw) as MockFile<T>;
    cache.set(promptId, parsed);
    return parsed;
  } catch (error) {
    logger.error('mock data missing or unreadable', {
      prompt_id: promptId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Picks the scenario to return.
 *
 * A caller can force one explicitly (`scenario: 'empty_shelf'`) to demo a
 * specific path — an empty shelf, a failed read — without contriving input.
 * Otherwise the default is used.
 */
function pick<T>(promptId: PromptId, scenario?: string): T | null {
  const file = load<T>(promptId);
  if (file === null) return null;

  if (scenario !== undefined && file.scenarios?.[scenario] !== undefined) {
    return file.scenarios[scenario];
  }
  return file.default;
}

const MOCK_MODEL = 'mock-deterministic';

function succeed<T>(promptId: PromptId, data: T, startedAt: number): AiResult<T> {
  return {
    ok: true,
    data,
    meta: {
      prompt_id: promptId,
      provider: 'mock',
      model: MOCK_MODEL,
      duration_ms: Date.now() - startedAt,
      // The mock spends nothing, and reporting a fake token count would make
      // cost dashboards lie.
      tokens_used: null,
    },
  };
}

function missing<T>(promptId: PromptId, startedAt: number): AiResult<T> {
  return {
    ok: false,
    reason: `no mock data for prompt ${promptId}`,
    meta: {
      prompt_id: promptId,
      provider: 'mock',
      model: MOCK_MODEL,
      duration_ms: Date.now() - startedAt,
      tokens_used: null,
    },
  };
}

export class MockAiProvider implements AiProvider {
  readonly name = 'mock' as const;

  /** Optional scenario override, set per-request for demos. */
  private scenario: string | undefined;

  useScenario(scenario: string | undefined): void {
    this.scenario = scenario;
  }

  extractIngredientsFromImages(input: { promptId: PromptId }): Promise<AiResult<string[]>> {
    const started = Date.now();
    const data = pick<string[]>(input.promptId, this.scenario);
    return Promise.resolve(
      data === null ? missing(input.promptId, started) : succeed(input.promptId, data, started),
    );
  }

  parseIngredientsFromText(input: { promptId: PromptId }): Promise<AiResult<string[]>> {
    const started = Date.now();
    const data = pick<string[]>(input.promptId, this.scenario);
    return Promise.resolve(
      data === null ? missing(input.promptId, started) : succeed(input.promptId, data, started),
    );
  }

  transcribeAudio(): Promise<AiResult<string>> {
    const started = Date.now();
    const id = PROMPT_IDS.AUDIO_TRANSCRIBE;
    const data = pick<string>(id, this.scenario);
    return Promise.resolve(data === null ? missing(id, started) : succeed(id, data, started));
  }

  generateRecipe(): Promise<AiResult<GeneratedRecipe>> {
    const started = Date.now();
    const id = PROMPT_IDS.RECIPE_GENERATE;
    const data = pick<GeneratedRecipe>(id, this.scenario);
    return Promise.resolve(data === null ? missing(id, started) : succeed(id, data, started));
  }

  answerQuestion(): Promise<AiResult<ChatAnswer>> {
    const started = Date.now();
    const id = PROMPT_IDS.CHAT_ANSWER;
    const data = pick<ChatAnswer>(id, this.scenario);
    return Promise.resolve(data === null ? missing(id, started) : succeed(id, data, started));
  }
}

export const mockAiProvider = new MockAiProvider();
