import { AiLogModel } from '@lib/ai/ai-log.model.js';
import { estimateCostUsd } from '@lib/analytics/ai-cost.js';
import { ok, type ServiceResult } from '@lib/service-result.js';

/**
 * What the AI audit page can show beyond a list of rows.
 *
 * A list answers "what happened". It cannot answer the three questions that
 * are the only reasons to open the page: what is this costing, which prompt is
 * failing, and is it getting slower.
 *
 * Everything here is aggregated from `ai_logs`, which already records prompt
 * id, provider, model, token counts, duration, parse outcome and the model's
 * own self-graded metrics. No new writes, no schema change.
 */

export interface AiStatsTotals {
  calls: number;
  failed: number;
  /** Calls whose reply did not survive zod. A prompt bug, not a transport one. */
  rejected: number;
  tokens_in: number;
  tokens_out: number;
  /** Null when no call used a model we have a rate for. */
  estimated_usd: number | null;
  p50_ms: number;
  /** What people actually feel. The mean hides timeouts. */
  p95_ms: number;
}

export interface AiPromptStat {
  prompt_id: string;
  calls: number;
  failed: number;
  rejected: number;
  tokens: number;
  estimated_usd: number | null;
  p95_ms: number;
  /** The model's own grade of its answer. Null when nothing recorded one. */
  avg_confidence: number | null;
  /** How much guessing it had to do. A rise here is the earliest prompt-rot signal. */
  avg_ambiguity: number | null;
}

export interface AiStats {
  days: number;
  totals: AiStatsTotals;
  daily: { date: string; calls: number; failed: number; tokens: number }[];
  by_prompt: AiPromptStat[];
  by_model: { model: string; calls: number; tokens: number; estimated_usd: number | null }[];
  by_provider: { provider: string; calls: number }[];
}

/** The percentile of an ASCENDING list. Nearest-rank, no interpolation. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

/**
 * Sums a cost that may be partly unknown.
 *
 * Returns null only when NOTHING could be priced — a gap in a chart is honest,
 * and a zero would read as "this is free" rather than "we do not know".
 */
function sumCost(parts: (number | null)[]): number | null {
  const known = parts.filter((p): p is number => p !== null);
  if (known.length === 0) return null;
  return Math.round(known.reduce((a, b) => a + b, 0) * 100) / 100;
}

interface LogRow {
  promptId: string;
  provider: string;
  model: string;
  parsed: boolean;
  ok: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number;
  metrics: Record<string, unknown> | null;
  createdAt: Date;
}

/** A self-graded metric, read defensively: it is `Mixed` in the schema. */
function metricOf(metrics: Record<string, unknown> | null, key: string): number | null {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

export class AdminAiStatsService {
  private static instance: AdminAiStatsService | undefined;

  static getInstance(): AdminAiStatsService {
    AdminAiStatsService.instance ??= new AdminAiStatsService();
    return AdminAiStatsService.instance;
  }

  /**
   * Everything, for one window.
   *
   * Read in ONE pass and reduced in memory rather than as six aggregation
   * pipelines. Cost has to be computed per row anyway — it depends on the
   * model, which Mongo cannot price — so a second pass over the same rows
   * would be strictly more work for the same answer.
   */
  async stats(days = 30): Promise<ServiceResult<AiStats>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = (await AiLogModel.find(
      { createdAt: { $gte: since } },
      {
        promptId: 1,
        provider: 1,
        model: 1,
        parsed: 1,
        ok: 1,
        promptTokens: 1,
        completionTokens: 1,
        durationMs: 1,
        metrics: 1,
        createdAt: 1,
      },
    )
      .lean()
      .exec()) as unknown as LogRow[];

    const durations: number[] = [];
    const costs: (number | null)[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let failed = 0;
    let rejected = 0;

    const byPrompt = new Map<
      string,
      {
        calls: number;
        failed: number;
        rejected: number;
        tokens: number;
        costs: (number | null)[];
        durations: number[];
        confidence: number[];
        ambiguity: number[];
      }
    >();
    const byModel = new Map<string, { calls: number; tokens: number; costs: (number | null)[] }>();
    const byProvider = new Map<string, number>();
    const byDay = new Map<string, { calls: number; failed: number; tokens: number }>();

    for (const row of rows) {
      const tokens = (row.promptTokens ?? 0) + (row.completionTokens ?? 0);
      const cost = estimateCostUsd(row.model, row.promptTokens, row.completionTokens);

      tokensIn += row.promptTokens ?? 0;
      tokensOut += row.completionTokens ?? 0;
      durations.push(row.durationMs);
      costs.push(cost);

      // A transport failure and a reply that did not parse are DIFFERENT
      // problems: one is theirs, one is ours. Counted apart.
      if (!row.ok) failed += 1;
      if (row.ok && !row.parsed) rejected += 1;

      const prompt = byPrompt.get(row.promptId) ?? {
        calls: 0, failed: 0, rejected: 0, tokens: 0,
        costs: [], durations: [], confidence: [], ambiguity: [],
      };
      prompt.calls += 1;
      prompt.tokens += tokens;
      prompt.costs.push(cost);
      prompt.durations.push(row.durationMs);
      if (!row.ok) prompt.failed += 1;
      if (row.ok && !row.parsed) prompt.rejected += 1;

      const confidence = metricOf(row.metrics, 'outputConfidence');
      if (confidence !== null) prompt.confidence.push(confidence);
      const ambiguity = metricOf(row.metrics, 'ambiguity');
      if (ambiguity !== null) prompt.ambiguity.push(ambiguity);
      byPrompt.set(row.promptId, prompt);

      const model = byModel.get(row.model) ?? { calls: 0, tokens: 0, costs: [] };
      model.calls += 1;
      model.tokens += tokens;
      model.costs.push(cost);
      byModel.set(row.model, model);

      byProvider.set(row.provider, (byProvider.get(row.provider) ?? 0) + 1);

      const date = row.createdAt.toISOString().slice(0, 10);
      const day = byDay.get(date) ?? { calls: 0, failed: 0, tokens: 0 };
      day.calls += 1;
      day.tokens += tokens;
      if (!row.ok) day.failed += 1;
      byDay.set(date, day);
    }

    durations.sort((a, b) => a - b);

    return ok({
      days,
      totals: {
        calls: rows.length,
        failed,
        rejected,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        estimated_usd: sumCost(costs),
        p50_ms: percentile(durations, 50),
        p95_ms: percentile(durations, 95),
      },
      daily: [...byDay.entries()]
        .map(([date, d]) => ({ date, ...d }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      by_prompt: [...byPrompt.entries()]
        .map(([prompt_id, p]) => {
          const sorted = [...p.durations].sort((a, b) => a - b);
          return {
            prompt_id,
            calls: p.calls,
            failed: p.failed,
            rejected: p.rejected,
            tokens: p.tokens,
            estimated_usd: sumCost(p.costs),
            p95_ms: percentile(sorted, 95),
            avg_confidence: mean(p.confidence),
            avg_ambiguity: mean(p.ambiguity),
          };
        })
        .sort((a, b) => b.calls - a.calls),
      by_model: [...byModel.entries()]
        .map(([model, m]) => ({
          model,
          calls: m.calls,
          tokens: m.tokens,
          estimated_usd: sumCost(m.costs),
        }))
        .sort((a, b) => b.calls - a.calls),
      by_provider: [...byProvider.entries()]
        .map(([provider, calls]) => ({ provider, calls }))
        .sort((a, b) => b.calls - a.calls),
    });
  }
}

export const adminAiStatsService = AdminAiStatsService.getInstance();
