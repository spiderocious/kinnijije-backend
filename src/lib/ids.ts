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
  job: 'job',
  email: 'email',
  reset: 'reset',
  ailog: 'ail',
  stock: 'stk',
  move: 'mv',
  unit: 'un',
  market: 'mk',
  meal: 'meal',
  /** A recipe image. Its own resource because it is addressed on its own. */
  recipeImage: 'img',
  chat: 'chat',
  insight: 'ins',
  decideLog: 'dlog',
  audit: 'audit',
  invite: 'inv',
  permissionGroup: 'grp',
  /** One saved decision, owned by a signed-in cook. */
  decideHistory: 'dhist',
  /** One outbound request to Chowdeck, kept for the console. */
  chowdeckCall: 'cdc',
  /** One cached Chowdeck search, per place and query. */
  chowdeckOffer: 'cdo',
  /** One tap through to Chowdeck. */
  chowdeckClick: 'cdk',
} as const;

/** Callers name the resource; the prefix itself is an implementation detail. */
export type IdResource = keyof typeof ID_PREFIXES;

export const newId = (resource: IdResource): string =>
  `${ID_PREFIXES[resource]}_${ulid().toLowerCase()}`;
