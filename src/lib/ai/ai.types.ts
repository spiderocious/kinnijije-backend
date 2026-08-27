import type { PromptId } from './prompts.js';

/**
 * Every AI result carries how it was produced.
 *
 * `provider` is what makes a demo honest: a response produced by the mock says
 * so, so nobody mistakes canned data for a real model read.
 */
export interface AiMeta {
  prompt_id: PromptId;
  provider: 'openai' | 'mock';
  model: string;
  /** Milliseconds the call took. */
  duration_ms: number;
  /** Null on the mock, which spends nothing. */
  tokens_used: number | null;
}

export type AiResult<T> =
  | { ok: true; data: T; meta: AiMeta }
  | { ok: false; reason: string; meta: AiMeta };

export interface GeneratedRecipeIngredient {
  name: string;
  quantity: string;
  /** Always true for generated recipes — the PRD requires estimates be labelled. */
  approximate: boolean;
}

export interface GeneratedRecipeStep {
  index: number;
  heading: string;
  description: string;
  est_minutes: number;
}

export interface GeneratedRecipe {
  name: string;
  cuisines: string[];
  difficulty: 'easy' | 'medium' | 'involved';
  cook_time_minutes: number;
  serves: number;
  ingredients: GeneratedRecipeIngredient[];
  steps: GeneratedRecipeStep[];
}

export interface ChatAnswer {
  answer: string;
  /** What the answer was based on, so the UI can show provenance. */
  citations: string[];
  /** kitchen = their own stock · recipe = a tested recipe · general = weakest. */
  source: 'kitchen' | 'recipe' | 'general';
}

/**
 * The contract both providers implement.
 *
 * Features depend on THIS, never on `openai` directly — which is what lets the
 * whole product run deterministically off canned data with one env change.
 */
export interface AiProvider {
  readonly name: 'openai' | 'mock';

  extractIngredientsFromImages(input: {
    promptId: PromptId;
    images: { base64: string; contentType: string }[];
  }): Promise<AiResult<string[]>>;

  parseIngredientsFromText(input: {
    promptId: PromptId;
    text: string;
  }): Promise<AiResult<string[]>>;

  transcribeAudio(input: { audio: Buffer; filename: string }): Promise<AiResult<string>>;

  generateRecipe(input: {
    ingredients: string[];
    cuisines: string[];
    difficulty: string;
  }): Promise<AiResult<GeneratedRecipe>>;

  answerQuestion(input: {
    question: string;
    kitchenContext: string[];
  }): Promise<AiResult<ChatAnswer>>;
}
