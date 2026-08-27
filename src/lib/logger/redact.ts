/**
 * Fields that must never reach a log sink, matched by key name at any depth.
 *
 * Redaction is on the logger, not on the callsites: a caller who forgets is
 * how a password ends up in a log file forever. When a new sensitive field is
 * introduced, add it here — do not trust callers to remember.
 */
const REDACTED_KEYS = new Set([
  'password',
  'password_confirmation',
  'current_password',
  'new_password',
  'passwordhash',
  'password_hash',
  'authorization',
  'cookie',
  'set-cookie',
  'access_token',
  'refresh_token',
  'refresh_token_hash',
  'token',
  'jwt',
  'secret',
  'api_key',
  'apikey',
  'otp',
  'pin',
  'cvv',
  'card_number',
  'bvn',
  'nin',
]);

/** Partially masked rather than dropped: still useful for support, not a leak. */
const MASKED_KEYS = new Set(['email', 'phone']);

export const CENSOR = '[REDACTED]';

const maskEmail = (value: string): string => {
  const at = value.indexOf('@');
  if (at <= 0) return CENSOR;
  const head = value.slice(0, at);
  const domain = value.slice(at);
  const visible = head.slice(0, Math.min(2, head.length));
  return `${visible}${'*'.repeat(Math.max(head.length - visible.length, 1))}${domain}`;
};

const maskTail = (value: string): string =>
  value.length <= 4 ? CENSOR : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;

/**
 * Depth-limited so a cyclic or pathologically deep object cannot stall the
 * logger; a `WeakSet` catches cycles outright.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const lowered = key.toLowerCase();

    if (REDACTED_KEYS.has(lowered)) {
      out[key] = CENSOR;
      continue;
    }

    if (MASKED_KEYS.has(lowered) && typeof item === 'string') {
      out[key] = lowered === 'email' ? maskEmail(item) : maskTail(item);
      continue;
    }

    out[key] = redact(item, depth + 1, seen);
  }
  return out;
}
