import type { ErrorCode, Severity } from '@shared/constants/error-codes.js';

/**
 * The error envelope does three jobs, and each gets its own field. Collapsing
 * them into one `code` does all three badly.
 *
 *   code     — Branch.  Stable snake_case identity. THE contract; clients
 *              switch on this and nothing else. Renaming one is breaking.
 *   message  — Display. Resolved human text from the message registry. Free to
 *              change, so it can never be the contract.
 *   severity — Measure. Coarse band for dashboards and alerting. Cannot
 *              distinguish dozens of reasons, so it cannot drive branching.
 *
 * `field_errors` appears on validation failures only. `rejection_reason` is a
 * diagnostic for operators — explicitly NOT part of the client contract, which
 * is precisely what lets it be renamed freely. No client may branch on it.
 */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  severity: Severity;
  field_errors?: Record<string, string[]>;
  rejection_reason?: string;
}

export interface ApiMeta {
  next_cursor: string | null;
  has_more: boolean;
}

export type ApiEnvelope<T> = { data: T; meta?: ApiMeta } | { error: ApiErrorBody };
