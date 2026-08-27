/**
 * Cursor pagination. Offset is banned: `skip(n)` re-scans n documents on every
 * page, and a concurrent insert shifts every subsequent page, so a user
 * scrolling a live feed silently sees an item twice or misses it entirely.
 *
 * The cursor encodes the last item's sort key and id. The id breaks ties when
 * two documents share a timestamp — without it, pagination stalls or skips.
 */
export interface Cursor {
  last_id: string;
  last_sort_key: string;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MAX_ADMIN_PAGE_SIZE = 100;

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

/**
 * Returns null rather than throwing on a malformed cursor. A cursor is opaque
 * to clients, so a bad one is either a truncated URL or someone poking at it —
 * neither deserves a 500, and falling back to the first page is harmless.
 */
export function decodeCursor(raw: string | undefined): Cursor | null {
  if (raw === undefined || raw.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;

    const { last_id, last_sort_key } = parsed as Partial<Cursor>;
    if (typeof last_id !== 'string' || typeof last_sort_key !== 'string') return null;

    return { last_id, last_sort_key };
  } catch {
    return null;
  }
}

/** Never trust a client-sent limit — clamp it. */
export const clampLimit = (requested: number | undefined, max = MAX_PAGE_SIZE): number => {
  if (requested === undefined || Number.isNaN(requested)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(requested), 1), max);
};
