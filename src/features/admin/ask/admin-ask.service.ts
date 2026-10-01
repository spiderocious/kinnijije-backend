import { AskSessionModel } from '@features/ask/ask.model.js';
import { ok, type ServiceResult } from '@lib/service-result.js';

import { DAY_MS, dailyCounts, trendPercent, type DailyCount } from '../dashboard/admin-series.js';

/**
 * What the console can see about Ask.
 *
 * The two numbers that decide this feature's fate — time-to-verdict and parse
 * accuracy — are computed HERE rather than from browser events, because an ad
 * blocker must not be able to hide a regression. Client analytics answer "what
 * are people doing"; this answers "is it working".
 */

export interface AskOverview {
  sessions: {
    total: number;
    completed: number;
    today: number;
    this_week: number;
    previous_week: number;
    trend: number | null;
    daily: DailyCount[];
  };
  /** How answers actually arrive. The reason voice and typing exist. */
  input: { tap: number; text: number; voice: number };
  turns: {
    total: number;
    failed: number;
    /** Turns whose parse produced at least one usable answer. */
    parsed: number;
    /** Median confidence across parsed turns, as a percent. */
    median_confidence: number | null;
  };
  voice: {
    attempted: number;
    transcribed: number;
    failed: number;
    /** Median and p95 transcription time, in ms. */
    median_ms: number | null;
    p95_ms: number | null;
  };
  /** Constraints people spoke that no tile could express. */
  notes: { sessions_with_notes: number; total_notes: number; top: { note: string; count: number }[] };
}

/** Percentiles over a sorted list. Small by construction, so a sort is fine. */
function at(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
}

export class AdminAskService {
  private static instance: AdminAskService | undefined;

  static getInstance(): AdminAskService {
    AdminAskService.instance ??= new AdminAskService();
    return AdminAskService.instance;
  }

  async overview(): Promise<ServiceResult<AskOverview>> {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);
    const twoWeeksAgo = new Date(Date.now() - 14 * DAY_MS);
    const seriesFrom = new Date(midnight.getTime() - 13 * DAY_MS);

    const [total, completed, today, thisWeek, previousWeek, daily, sessions] = await Promise.all([
      AskSessionModel.countDocuments().exec(),
      AskSessionModel.countDocuments({ completedAt: { $ne: null } }).exec(),
      AskSessionModel.countDocuments({ createdAt: { $gte: midnight } }).exec(),
      AskSessionModel.countDocuments({ createdAt: { $gte: weekAgo } }).exec(),
      AskSessionModel.countDocuments({ createdAt: { $gte: twoWeeksAgo, $lt: weekAgo } }).exec(),
      dailyCounts(AskSessionModel, seriesFrom),
      // Bounded: the turn detail is only needed for the newest sessions, and
      // scanning every row ever written would grow without limit.
      AskSessionModel.find({}, { turns: 1, carriedNotes: 1 })
        .sort({ createdAt: -1 })
        .limit(1_000)
        .lean()
        .exec(),
    ]);

    const input = { tap: 0, text: 0, voice: 0 };
    const confidences: number[] = [];
    const transcribeMs: number[] = [];
    const noteCounts = new Map<string, number>();
    let turnTotal = 0;
    let turnFailed = 0;
    let turnParsed = 0;
    let voiceAttempted = 0;
    let voiceFailed = 0;
    let sessionsWithNotes = 0;
    let totalNotes = 0;

    for (const session of sessions) {
      if (session.carriedNotes.length > 0) {
        sessionsWithNotes += 1;
        totalNotes += session.carriedNotes.length;
        for (const note of session.carriedNotes) {
          const key = note.toLowerCase();
          noteCounts.set(key, (noteCounts.get(key) ?? 0) + 1);
        }
      }

      for (const turn of session.turns) {
        turnTotal += 1;
        input[turn.source] += 1;
        if (turn.status === 'failed') turnFailed += 1;
        if (turn.answers !== null) turnParsed += 1;
        if (turn.confidence !== null) confidences.push(turn.confidence);
        if (turn.source === 'voice') {
          voiceAttempted += 1;
          if (turn.failedStage === 'transcribe') voiceFailed += 1;
          if (turn.transcribeMs !== null) transcribeMs.push(turn.transcribeMs);
        }
      }
    }

    confidences.sort((a, b) => a - b);
    transcribeMs.sort((a, b) => a - b);

    const medianConfidence = at(confidences, 0.5);

    return ok({
      sessions: {
        total,
        completed,
        today,
        this_week: thisWeek,
        previous_week: previousWeek,
        trend: trendPercent(thisWeek, previousWeek),
        daily,
      },
      input,
      turns: {
        total: turnTotal,
        failed: turnFailed,
        parsed: turnParsed,
        median_confidence: medianConfidence === null ? null : Math.round(medianConfidence * 100),
      },
      voice: {
        attempted: voiceAttempted,
        transcribed: voiceAttempted - voiceFailed,
        failed: voiceFailed,
        median_ms: at(transcribeMs, 0.5),
        p95_ms: at(transcribeMs, 0.95),
      },
      notes: {
        sessions_with_notes: sessionsWithNotes,
        total_notes: totalNotes,
        top: [...noteCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([note, count]) => ({ note, count })),
      },
    });
  }
}

export const adminAskService = AdminAskService.getInstance();
