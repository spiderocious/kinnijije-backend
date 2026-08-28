import { AiLogModel } from '@lib/ai/ai-log.model.js';
import { isoOrNull } from '@lib/dates.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

/**
 * The AI audit.
 *
 * Every call is already logged with its prompt, its raw answer and why it was
 * rejected — this exposes that. It is the single most useful screen when
 * something "the AI did" turns out to be something we did.
 */
export class AdminAiService {
  private static instance: AdminAiService | undefined;

  static getInstance(): AdminAiService {
    AdminAiService.instance ??= new AdminAiService();
    return AdminAiService.instance;
  }

  async list(query: {
    promptId?: string;
    ok?: boolean;
    ownerId?: string;
    provider?: string;
    limit?: number;
    skip?: number;
  }): Promise<ServiceResult<{ items: unknown[]; total: number }>> {
    const filter: Record<string, unknown> = {};
    if (query.promptId !== undefined) filter['promptId'] = query.promptId;
    if (query.ok !== undefined) filter['ok'] = query.ok;
    if (query.ownerId !== undefined) filter['ownerId'] = query.ownerId;
    if (query.provider !== undefined) filter['provider'] = query.provider;

    const limit = Math.min(query.limit ?? 50, 200);
    const [rows, total] = await Promise.all([
      AiLogModel.find(filter)
        // The heavy fields are excluded from the LIST — a prompt and its raw
        // answer are kilobytes each, and fifty of them is a slow screen.
        .select('-systemPrompt -userPrompt -rawResponse')
        .sort({ createdAt: -1 })
        .skip(query.skip ?? 0)
        .limit(limit)
        .exec(),
      AiLogModel.countDocuments(filter).exec(),
    ]);

    return ok({
      items: rows.map((row) => ({
        id: row._id,
        prompt_id: row.promptId,
        provider: row.provider,
        model: row.get('model'),
        owner_id: row.ownerId,
        ok: row.ok,
        error: row.error,
        parse_error: row.parseError,
        prompt_tokens: row.promptTokens,
        completion_tokens: row.completionTokens,
        total_tokens: row.totalTokens,
        duration_ms: row.durationMs,
        metrics: row.metrics,
        created_at: isoOrNull(row.createdAt),
      })),
      total,
    });
  }

  /** One call, in full — including what was actually sent and what came back. */
  async detail(logId: string): Promise<ServiceResult<unknown>> {
    const row = await AiLogModel.findById(logId).exec();
    if (row === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.common.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    return ok({
      id: row._id,
      prompt_id: row.promptId,
      provider: row.provider,
      model: row.get('model'),
      owner_id: row.ownerId,
      system_prompt: row.systemPrompt,
      user_prompt: row.userPrompt,
      image_refs: row.imageRefs,
      raw_response: row.rawResponse,
      parsed: row.parsed,
      parse_error: row.parseError,
      metrics: row.metrics,
      prompt_tokens: row.promptTokens,
      completion_tokens: row.completionTokens,
      total_tokens: row.totalTokens,
      duration_ms: row.durationMs,
      ok: row.ok,
      error: row.error,
      created_at: isoOrNull(row.createdAt),
    });
  }

  /** The distinct prompt ids that have actually run, for the filter rail. */
  async promptIds(): Promise<ServiceResult<string[]>> {
    const ids = await AiLogModel.distinct('promptId').exec();
    return ok(ids.map(String).sort());
  }
}

export const adminAiService = AdminAiService.getInstance();
