import { env } from '@app/env.js';
import { SERVER_EVENTS, analytics } from '@lib/analytics/index.js';
import { FEATURE_FLAGS, flagsService } from '@lib/flags/index.js';
import { getContext } from '@lib/http/request-context.js';
import { newId } from '@lib/ids.js';
import { logger } from '@lib/logger/index.js';
import { rateLimitStore } from '@lib/ratelimit/index.js';

import {
  AutocompleteResponseSchema,
  SearchResponseSchema,
  type AutocompletePrediction,
} from './chowdeck.contracts.js';
import {
  ChowdeckCallModel,
  MAX_STORED_BODY_BYTES,
  type ChowdeckCallKind,
  type ChowdeckCallStatus,
  type ChowdeckCallTrigger,
  type StoredVendor,
} from './chowdeck.model.js';
import { lagosClock, normaliseVendors } from './chowdeck.offers.js';

/**
 * The ONLY way anything reaches Chowdeck.
 *
 * Their customer API has no key, so nothing on their side will slow us down
 * before it blocks us. Every guard therefore lives here, in one place, in
 * front of every caller — a cook's cache miss, a console search, a replay, a
 * fetch-ahead job all pass through the same checks in the same order:
 *
 *   1. the kill switch  (flag `chowdeck_fetch`)
 *   2. the breaker      (paused after repeated failures)
 *   3. the daily cap    (per Lagos day, counted from the call log)
 *   4. the minute rate  (one token bucket, shared by everyone)
 *
 * And every attempt — sent or refused — is written to the call log with what
 * came back, so the console can show exactly what we asked and what we got.
 */

/** Ten seconds. Their search is slow on a cold area; three was cutting off real answers. */
export const CHOWDECK_TIMEOUT_MS = 10_000;

/** Consecutive failures before we stop calling. */
const BREAKER_THRESHOLD = 5;
/** How long we stop for. A 429 trips it at once. */
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

/** The one bucket every outbound call draws from. */
const OUTBOUND_BUCKET = 'chowdeck:outbound';

export type RefusalReason = 'fetch_disabled' | 'breaker_open' | 'daily_cap' | 'rate_limited';

export interface CallMeta {
  trigger: ChowdeckCallTrigger;
  actorId?: string | null | undefined;
  replayOf?: string | null | undefined;
  /**
   * Wait for a token instead of refusing. Only a background job may: a cook
   * or a console click gets an answer now, not a request held open.
   */
  waitForSlot?: boolean | undefined;
  /** A job's cancel check, polled while waiting for a slot. */
  isCancelled?: (() => Promise<boolean>) | undefined;
}

export interface CallOutcome<T> {
  callId: string;
  status: ChowdeckCallStatus;
  httpStatus: number | null;
  durationMs: number;
  error: string | null;
  refusal: RefusalReason | null;
  /** Present only when status is `ok`. */
  data: T | null;
}

export interface SearchData {
  vendors: StoredVendor[];
  rawCount: number;
  dropped: number;
}

// ── Breaker and daily count, in process memory ──────────────────────────

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number;
  lastFailureAt: number | null;
  lastError: string | null;
}

const breaker: BreakerState = {
  consecutiveFailures: 0,
  openUntil: 0,
  lastFailureAt: null,
  lastError: null,
};

/**
 * Calls sent today. Seeded from the call log on first use each day, so a
 * restart does not hand out a fresh allowance.
 */
let today: { day: string; count: number } | null = null;
let seeding: Promise<void> | null = null;

/** Lagos midnight, as a UTC instant. */
function lagosDayStart(now: Date): Date {
  const { minutes } = lagosClock(now);
  const start = new Date(now.getTime() - minutes * 60_000);
  start.setUTCSeconds(0, 0);
  return start;
}

const lagosDayKey = (now: Date): string => lagosDayStart(now).toISOString().slice(0, 16);

async function sentToday(): Promise<{ day: string; count: number }> {
  const now = new Date();
  const day = lagosDayKey(now);
  if (today?.day === day) return today;

  seeding ??= (async () => {
    const count = await ChowdeckCallModel.countDocuments({
      createdAt: { $gte: lagosDayStart(now) },
      status: { $ne: 'refused' },
    }).exec();
    today = { day, count };
  })().finally(() => {
    seeding = null;
  });
  await seeding;
  return today ?? { day, count: 0 };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

/** Past this, a waiting job gives up on a slot and the pair is skipped. */
const MAX_SLOT_WAIT_MS = 2 * 60 * 1000;

async function acquire(meta: CallMeta): Promise<RefusalReason | null> {
  if (!(await flagsService.isOn(FEATURE_FLAGS.CHOWDECK_FETCH))) return 'fetch_disabled';
  if (breaker.openUntil > Date.now()) return 'breaker_open';

  const counted = await sentToday();
  if (counted.count >= env.CHOWDECK_DAILY_CAP) return 'daily_cap';

  const perMinute = env.CHOWDECK_CALLS_PER_MINUTE;
  const started = Date.now();

  for (;;) {
    const decision = await rateLimitStore.consume(OUTBOUND_BUCKET, perMinute, perMinute / 60);
    if (decision.allowed) {
      counted.count += 1;
      return null;
    }
    if (meta.waitForSlot !== true) return 'rate_limited';
    if (Date.now() - started > MAX_SLOT_WAIT_MS) return 'rate_limited';
    if (meta.isCancelled !== undefined && (await meta.isCancelled())) return 'rate_limited';
    await sleep(decision.retryAfterSeconds * 1000);
    // The switch may have been thrown while we waited.
    if (!(await flagsService.isOn(FEATURE_FLAGS.CHOWDECK_FETCH))) return 'fetch_disabled';
  }
}

function recordFailure(status: ChowdeckCallStatus, httpStatus: number | null, error: string): void {
  breaker.consecutiveFailures += 1;
  breaker.lastFailureAt = Date.now();
  breaker.lastError = error;

  // A 429 is them telling us directly. Stop now rather than after four more.
  const tooMany = httpStatus === 429;
  if (tooMany || breaker.consecutiveFailures >= BREAKER_THRESHOLD) {
    breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    logger.warn('chowdeck breaker opened', {
      status,
      http_status: httpStatus,
      failures: breaker.consecutiveFailures,
      cooldown_ms: BREAKER_COOLDOWN_MS,
    });
  }
}

function recordSuccess(): void {
  breaker.consecutiveFailures = 0;
}

// ── Single flight ────────────────────────────────────────────────────────

const inFlight = new Map<string, Promise<unknown>>();

/**
 * One call per key at a time. Five cooks missing the same cache row at once
 * share one request, and so share its answer.
 */
export function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing as Promise<T>;

  const promise = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

// ── The call itself ──────────────────────────────────────────────────────

/** Sent on every call, and stored with it, so the log shows exactly what they received. */
const REQUEST_HEADERS: Readonly<Record<string, string>> = { Accept: 'application/json' };

/** Every response header, as sent. Header names are already lowercase in a fetch Headers object. */
function headersOf(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * The system-level code behind a failed fetch, when there is one.
 *
 * Node's fetch wraps the real reason in `cause` (ECONNREFUSED, ENOTFOUND,
 * UND_ERR_CONNECT_TIMEOUT…); the top-level message is just "fetch failed",
 * which tells nobody whether Chowdeck is down or we are.
 */
function errorCodeOf(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== null && typeof cause === 'object') {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return error.name === 'AbortError' ? 'ABORTED' : null;
}

function errorMessageOf(error: unknown): string {
  if (!(error instanceof Error)) return 'network error';
  const cause = (error as { cause?: unknown }).cause;
  // "fetch failed: connect ECONNREFUSED 1.2.3.4:443" — the useful half is in the cause.
  return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message;
}

interface Parsed<T> {
  ok: boolean;
  data: T | null;
  resultCount: number | null;
  error: string | null;
}

async function call<T>(
  kind: ChowdeckCallKind,
  path: string,
  params: Record<string, string>,
  meta: CallMeta,
  parse: (json: unknown) => Parsed<T>,
): Promise<CallOutcome<T>> {
  const callId = newId('chowdeckCall');
  const url = `${env.CHOWDECK_API_BASE.replace(/\/+$/, '')}${path}?${new URLSearchParams(params).toString()}`;
  const started = Date.now();

  /**
   * Every attempt is written, whatever happened — including the full response
   * headers and body whenever there was a response at all. A 429, a 503 from
   * their CDN and a genuine answer all leave the same complete record.
   */
  const log = (row: {
    status: ChowdeckCallStatus;
    httpStatus?: number | null;
    resultCount?: number | null;
    error?: string | null;
    errorCode?: string | null;
    headers?: Record<string, string> | null;
    body?: string | null;
  }): void => {
    const body = row.body ?? null;
    const bytes = body === null ? null : Buffer.byteLength(body, 'utf8');
    const truncated = bytes !== null && bytes > MAX_STORED_BODY_BYTES;

    // Not awaited: a cook must never wait on our own bookkeeping. The catch
    // is what makes that safe.
    void ChowdeckCallModel.create({
      _id: callId,
      kind,
      trigger: meta.trigger,
      actorId: meta.actorId ?? null,
      url,
      params,
      status: row.status,
      httpStatus: row.httpStatus ?? null,
      durationMs: Date.now() - started,
      resultCount: row.resultCount ?? null,
      error: row.error ?? null,
      errorCode: row.errorCode ?? null,
      // A refused call was never sent, so it has no request headers to record.
      requestHeaders: row.status === 'refused' ? {} : REQUEST_HEADERS,
      responseHeaders: row.headers ?? null,
      responseBody: truncated && body !== null ? body.slice(0, MAX_STORED_BODY_BYTES) : body,
      responseBytes: bytes,
      truncated,
      replayOf: meta.replayOf ?? null,
      requestId: getContext()?.request_id ?? null,
    }).catch((error: unknown) => {
      logger.warn('chowdeck call log failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    });

    if (row.status !== 'refused') {
      analytics.track(SERVER_EVENTS.CHOWDECK_CALL_COMPLETED, 'system', {
        kind,
        trigger: meta.trigger,
        status: row.status,
        http_status: row.httpStatus ?? null,
        duration_ms: Date.now() - started,
        result_count: row.resultCount ?? null,
      });
    }
    if (row.status !== 'ok' && row.status !== 'refused') {
      analytics.track(SERVER_EVENTS.UPSTREAM_FAILURE, 'system', {
        dependency: 'chowdeck',
        operation: kind,
        duration_ms: Date.now() - started,
        http_status: row.httpStatus ?? null,
      });
    }
  };

  const outcome = (
    status: ChowdeckCallStatus,
    extra: Partial<Omit<CallOutcome<T>, 'callId' | 'status'>> = {},
  ): CallOutcome<T> => ({
    callId,
    status,
    httpStatus: extra.httpStatus ?? null,
    durationMs: Date.now() - started,
    error: extra.error ?? null,
    refusal: extra.refusal ?? null,
    data: extra.data ?? null,
  });

  const refusal = await acquire(meta);
  if (refusal !== null) {
    log({ status: 'refused', error: refusal });
    return outcome('refused', { refusal, error: refusal });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CHOWDECK_TIMEOUT_MS);
  timer.unref();

  let response: Response;
  try {
    response = await fetch(url, { headers: REQUEST_HEADERS, signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    const timedOut = controller.signal.aborted;
    const status: ChowdeckCallStatus = timedOut ? 'timeout' : 'network_error';
    const message = timedOut ? `no answer within ${String(CHOWDECK_TIMEOUT_MS)}ms` : errorMessageOf(error);
    const errorCode = timedOut ? 'TIMEOUT' : errorCodeOf(error);
    recordFailure(status, null, message);
    log({ status, error: message, errorCode });
    return outcome(status, { error: message });
  }

  // Captured before the body is read, so even a body that never finishes
  // leaves the status line and headers on record.
  const headers = headersOf(response);
  const httpStatus = response.status;

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    clearTimeout(timer);
    const timedOut = controller.signal.aborted;
    const status: ChowdeckCallStatus = timedOut ? 'timeout' : 'network_error';
    const message = timedOut
      ? `body not finished within ${String(CHOWDECK_TIMEOUT_MS)}ms`
      : errorMessageOf(error);
    recordFailure(status, httpStatus, message);
    log({ status, httpStatus, headers, error: message, errorCode: timedOut ? 'TIMEOUT' : errorCodeOf(error) });
    return outcome(status, { httpStatus, error: message });
  }
  clearTimeout(timer);

  if (!response.ok) {
    // Named, so the log line itself says which kind of refusal it was.
    const message =
      httpStatus === 429
        ? `HTTP 429 — rate limited${headers['retry-after'] !== undefined ? `, retry after ${headers['retry-after']}s` : ''}`
        : httpStatus >= 500
          ? `HTTP ${String(httpStatus)} — their side failed`
          : `HTTP ${String(httpStatus)}`;
    // A 404 for a place they no longer know is an answer, not an outage.
    if (httpStatus >= 500 || httpStatus === 429) {
      recordFailure('http_error', httpStatus, message);
    }
    log({ status: 'http_error', httpStatus, headers, error: message, body });
    return outcome('http_error', { httpStatus, error: message });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    const message = 'response is not JSON';
    recordFailure('parse_error', httpStatus, message);
    log({ status: 'parse_error', httpStatus, headers, error: message, body });
    return outcome('parse_error', { httpStatus, error: message });
  }

  const parsed = parse(json);
  if (!parsed.ok) {
    const message = parsed.error ?? 'unexpected shape';
    recordFailure('parse_error', httpStatus, message);
    log({ status: 'parse_error', httpStatus, headers, error: message, resultCount: parsed.resultCount, body });
    return outcome('parse_error', { httpStatus, error: message });
  }

  recordSuccess();
  log({ status: 'ok', httpStatus, headers, resultCount: parsed.resultCount, body });
  return outcome('ok', { httpStatus, data: parsed.data });
}

const firstIssue = (error: { issues: { path: (string | number)[]; message: string }[] }): string => {
  const issue = error.issues[0];
  return issue === undefined ? 'unexpected shape' : `${issue.path.join('.') || '(root)'}: ${issue.message}`;
};

// ── Public surface ───────────────────────────────────────────────────────

export const chowdeckClient = {
  /** Their place autocomplete. Only the console calls this; cooks search our table. */
  autocomplete(input: string, meta: CallMeta): Promise<CallOutcome<AutocompletePrediction[]>> {
    return call('autocomplete', '/place/autocomplete/json', { input }, meta, (json) => {
      const parsed = AutocompleteResponseSchema.safeParse(json);
      if (!parsed.success) {
        return { ok: false, data: null, resultCount: null, error: firstIssue(parsed.error) };
      }
      return {
        ok: true,
        data: parsed.data.predictions,
        resultCount: parsed.data.predictions.length,
        error: null,
      };
    });
  },

  /** Restaurants in one place that sell something matching `query`. */
  search(addressId: string, query: string, meta: CallMeta): Promise<CallOutcome<SearchData>> {
    const params = { address_id: addressId, type: 'restaurant', query };
    return call('search', '/customer/search/product', params, meta, (json) => {
      const envelope = SearchResponseSchema.safeParse(json);
      if (!envelope.success) {
        return { ok: false, data: null, resultCount: null, error: firstIssue(envelope.error) };
      }

      const rawCount = envelope.data.data.length;
      const { vendors, dropped } = normaliseVendors(envelope.data.data);

      // Some vendors failing is tolerated and counted. ALL of them failing
      // means the shape moved, and a cache row of nothing would hide that.
      if (rawCount > 0 && vendors.length === 0) {
        return {
          ok: false,
          data: null,
          resultCount: rawCount,
          error: `all ${String(rawCount)} vendors failed the schema`,
        };
      }

      return { ok: true, data: { vendors, rawCount, dropped }, resultCount: rawCount, error: null };
    });
  },

  /** For the console: what the guards currently say. */
  async state(): Promise<{
    fetch_enabled: boolean;
    breaker: {
      open: boolean;
      open_until: string | null;
      consecutive_failures: number;
      threshold: number;
      last_failure_at: string | null;
      last_error: string | null;
    };
    today: { sent: number; cap: number };
    per_minute: number;
    timeout_ms: number;
    in_flight: number;
  }> {
    const counted = await sentToday();
    const open = breaker.openUntil > Date.now();
    return {
      fetch_enabled: await flagsService.isOn(FEATURE_FLAGS.CHOWDECK_FETCH),
      breaker: {
        open,
        open_until: open ? new Date(breaker.openUntil).toISOString() : null,
        consecutive_failures: breaker.consecutiveFailures,
        threshold: BREAKER_THRESHOLD,
        last_failure_at: breaker.lastFailureAt === null ? null : new Date(breaker.lastFailureAt).toISOString(),
        last_error: breaker.lastError,
      },
      today: { sent: counted.count, cap: env.CHOWDECK_DAILY_CAP },
      per_minute: env.CHOWDECK_CALLS_PER_MINUTE,
      timeout_ms: CHOWDECK_TIMEOUT_MS,
      in_flight: inFlight.size,
    };
  },

  /** A person decided they have waited long enough. Logged, because it overrides a safety. */
  resetBreaker(actorId: string): void {
    breaker.consecutiveFailures = 0;
    breaker.openUntil = 0;
    logger.info('chowdeck breaker reset by hand', { by: actorId });
  },
};
