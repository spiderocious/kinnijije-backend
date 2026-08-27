import { ulid } from 'ulidx';

/**
 * Resource-prefixed ULIDs. Prefixes make an id self-describing in a log line
 * or a support ticket — you can tell what `u_01hv…` is without a lookup.
 *
 * ULID rather than UUID because it sorts monotonically by creation time, which
 * makes it usable as a cursor. Clients treat these as opaque and never parse
 * them.
 */
export const ID_PREFIXES = {
  user: 'u',
  session: 'sess',
  file: 'f',
} as const;

/** Callers name the resource; the prefix itself is an implementation detail. */
export type IdResource = keyof typeof ID_PREFIXES;

export const newId = (resource: IdResource): string =>
  `${ID_PREFIXES[resource]}_${ulid().toLowerCase()}`;
