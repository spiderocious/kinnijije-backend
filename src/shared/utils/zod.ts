import type { ZodError } from 'zod';

/**
 * Groups Zod issues by field path for the envelope's `field_errors`.
 *
 * Policy: ALL invalid fields are returned, not just the first. This is a
 * product decision, and it is applied identically here and in the error
 * handler — splitting it between the two is how a form shows one error on
 * submit and five on re-render.
 */
export const fieldErrorsFromZod = (error: ZodError): Record<string, string[]> => {
  const grouped: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
    const existing = grouped[path];
    if (existing === undefined) grouped[path] = [issue.message];
    else existing.push(issue.message);
  }

  return grouped;
};
