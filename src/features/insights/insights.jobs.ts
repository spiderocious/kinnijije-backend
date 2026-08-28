import { aiService, PROMPT_IDS, WeekInsightSchema } from '@lib/ai/index.js';
import { jobQueue } from '@lib/jobs/jobs.queue.js';
import type { JobContext } from '@lib/jobs/jobs.types.js';
import { logger } from '@lib/logger/index.js';

import { insightsService, MIN_MEALS_FOR_INSIGHT } from './insights.service.js';

export const INSIGHT_JOB_TYPE = 'week-reading';

/**
 * Computes the AI reading of a week, in the background.
 *
 * Queued rather than computed on request for the usual reason: nobody should
 * wait on a model to see their own numbers. The deterministic summary renders
 * immediately; this fills in underneath when it is ready.
 */
async function runWeekReading(payload: unknown, ctx: JobContext): Promise<unknown> {
  const { ownerId } = payload as { ownerId: string };

  await ctx.setProgress(0.2, 'Looking at your week');

  const summary = await insightsService.weekSummary(ownerId);
  if (!summary.success) return { skipped: true, reason: 'could not read the week' };

  // Under four meals we say nothing rather than stretch three into a pattern.
  // Spending a model call to be told that would be waste.
  if (summary.data.total_meals < MIN_MEALS_FOR_INSIGHT) {
    const payloadOut = {
      headline: 'Too early to say anything useful.',
      observations: [],
      suggestion: null,
      notes: { summary: `Cook a few more meals and there will be something to notice.` },
    };
    await insightsService.saveReading(ownerId, payloadOut);
    return payloadOut;
  }

  await ctx.setProgress(0.5, 'Working out what stands out');

  const answer = await aiService.call({
    promptId: PROMPT_IDS.WEEK_INSIGHT,
    schema: WeekInsightSchema,
    userPrompt: [
      `MEALS COOKED THIS WEEK (${String(summary.data.total_meals)} total, ${String(summary.data.distinct_meals)} distinct):`,
      ...summary.data.days.map((d) => `  ${d.label} ${d.date}: ${d.meals.length > 0 ? d.meals.join(', ') : '(nothing)'}`),
      '',
      `REPEATED: ${summary.data.repeats.map((r) => `${r.name} x${String(r.times)}`).join(', ') || '(none)'}`,
      `INGREDIENTS USED MOST: ${summary.data.used_most.map((u) => `${u.name} (${String(u.times)})`).join(', ') || '(none)'}`,
      `ROUGH SPEND: ₦${String(summary.data.estimated_spend)}`,
      '',
      'Respond with JSON: { headline, observations, suggestion, notes, metrics }',
    ].join('\n'),
    ownerId,
    tier: 'large',
  });

  await ctx.setProgress(0.9, 'Writing it up');

  if (!answer.ok || answer.data === null) {
    logger.warn('week reading rejected', { owner: ownerId, error: answer.error });
    // No reading is fine — the numbers still render. Saving a broken one is not.
    return { skipped: true, reason: answer.error };
  }

  await insightsService.saveReading(ownerId, answer.data);
  await ctx.setProgress(1, 'Done');

  return answer.data;
}

export function registerInsightHandlers(): void {
  jobQueue.register(INSIGHT_JOB_TYPE, runWeekReading);
}
