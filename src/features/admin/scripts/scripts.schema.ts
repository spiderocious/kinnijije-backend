import { z } from 'zod';

/**
 * Only a flag.
 *
 * Deliberately NOT a place to pass arbitrary arguments: the script id selects
 * from a closed list in the registry, and nothing here is evaluated. A runner
 * that accepted code, or a filter, or a collection name, would be a remote
 * execution endpoint with a permission check in front of it.
 */
export const RunScriptSchema = z.object({
  /** Report without writing. Ignored by scripts that only read. */
  dry_run: z.boolean().default(false),
});
