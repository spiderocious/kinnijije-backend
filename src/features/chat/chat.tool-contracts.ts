import { z } from 'zod';

/**
 * The tool protocol.
 *
 * Modelled on how MCP and agent runtimes work: the app declares what it can do,
 * the model emits calls, the runtime executes them and hands the RESULTS back,
 * and the model's next turn explains what happened. The person sees that second
 * answer — never the raw execution.
 *
 * The safety rule that everything else follows from: **the model names things,
 * it never identifies them.** No owner, no record id, no catalogue id ever
 * comes from a model. Those are resolved on our side from the authenticated
 * session, so a model cannot address data it was not given.
 */

export const TOOL_GROUPS = {
  STOCK: 'stock',
  MARKET: 'market',
  MEALS: 'meals',
} as const;

export type ToolGroup = (typeof TOOL_GROUPS)[keyof typeof TOOL_GROUPS];

/**
 * Metadata the model attaches to a call.
 *
 * Entirely for our records — it is logged, never trusted, and never used to
 * decide anything. A model claiming `user: "someone-else"` changes nothing,
 * because ownership is read from the session.
 */
export const ToolMetadataSchema = z
  .object({
    thought: z.string().max(500).optional(),
    confidence: z.number().min(0).max(1).optional(),
    outputLevel: z.string().max(40).optional(),
  })
  .passthrough();

const ItemPayload = z.object({
  name: z.string().min(1).max(80),
  quantity: z.number().positive().max(10_000).optional(),
  unit: z.string().max(40).optional(),
});

/**
 * Every tool the model may call.
 *
 * A discriminated union so an unknown tool fails to parse rather than falling
 * through to something that "did nothing" but reported success.
 */
export const ToolCallSchema = z.discriminatedUnion('tool', [
  z.object({
    tool: z.literal('addToStock'),
    toolGroup: z.literal(TOOL_GROUPS.STOCK),
    toolPayload: z.object({ items: z.array(ItemPayload).min(1).max(30) }),
    metadata: ToolMetadataSchema.optional(),
  }),
  z.object({
    tool: z.literal('removeFromStock'),
    toolGroup: z.literal(TOOL_GROUPS.STOCK),
    toolPayload: z.object({ names: z.array(z.string().min(1).max(80)).min(1).max(30) }),
    metadata: ToolMetadataSchema.optional(),
  }),
  z.object({
    tool: z.literal('addToMarket'),
    toolGroup: z.literal(TOOL_GROUPS.MARKET),
    toolPayload: z.object({
      items: z.array(ItemPayload.extend({ reason: z.string().max(200).optional() })).min(1).max(30),
    }),
    metadata: ToolMetadataSchema.optional(),
  }),
  z.object({
    tool: z.literal('removeFromMarket'),
    toolGroup: z.literal(TOOL_GROUPS.MARKET),
    toolPayload: z.object({ names: z.array(z.string().min(1).max(80)).min(1).max(30) }),
    metadata: ToolMetadataSchema.optional(),
  }),
  z.object({
    tool: z.literal('readStock'),
    toolGroup: z.literal(TOOL_GROUPS.STOCK),
    toolPayload: z.object({}).optional(),
    metadata: ToolMetadataSchema.optional(),
  }),
  z.object({
    tool: z.literal('readMarket'),
    toolGroup: z.literal(TOOL_GROUPS.MARKET),
    toolPayload: z.object({}).optional(),
    metadata: ToolMetadataSchema.optional(),
  }),
  z.object({
    tool: z.literal('suggestMeals'),
    toolGroup: z.literal(TOOL_GROUPS.MEALS),
    toolPayload: z.object({ limit: z.number().int().min(1).max(5).optional() }).optional(),
    metadata: ToolMetadataSchema.optional(),
  }),
]);

export type ToolCall = z.infer<typeof ToolCallSchema>;

/** A batch. The model may ask for several things in one turn. */
export const ToolCallBatchSchema = z.array(ToolCallSchema).max(6);

/**
 * Deterministic outcome codes.
 *
 * Numeric and stable so the model can branch on them without reading prose —
 * and so a partial failure is legible rather than a wall of English.
 */
export const RESULT_CODES = {
  OK: 200,
  /** Ran, but nothing changed — everything was already as asked. */
  NO_CHANGE: 204,
  /** Queued; the answer comes later. */
  PENDING: 202,
  /** The payload did not fit the contract. */
  INVALID_PAYLOAD: 400,
  /** Nothing by that name exists for this person. */
  NOT_FOUND: 404,
  /** The state does not allow it — out of stock, already bought. */
  IMPOSSIBLE_STATE: 409,
  /** The tool itself is not something this app offers. */
  UNKNOWN_TOOL: 501,
  /** Something broke on our side. */
  FAILED: 500,
} as const;

export type ResultCode = (typeof RESULT_CODES)[keyof typeof RESULT_CODES];

export interface ToolResult {
  tool: string;
  toolGroup: string;
  toolPayload: unknown;
  result: 'success' | 'failed' | 'pending';
  resultCode: ResultCode;
  /**
   * The state AFTER the call, when it changed — so the model can describe what
   * the person now has without a second round trip to find out.
   */
  updatedData?: unknown;
  /** Why it failed, in words the model can pass on. */
  error?: string;
  /** What was skipped and why, when only part of a batch worked. */
  partial?: { name: string; reason: string }[];
}
