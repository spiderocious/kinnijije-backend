import { config } from 'dotenv';
import { z } from 'zod';

config();

/**
 * Parsed once, at boot. A malformed environment must fail loudly here rather
 * than surfacing as a confusing runtime error three layers deep.
 *
 * Production-only requirements (a real RESEND_API_KEY, non-default secrets)
 * are asserted in server.ts instead, so development can still boot without
 * production secrets.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  MONGODB_URI: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // ---- Object storage (S3-compatible: AWS, R2, MinIO) ----
  // Left empty in development, storage runs in a "not configured" mode that
  // refuses uploads with a clear error rather than failing at the SDK level.
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  // How long a presigned upload URL stays valid. Short: it is handed out
  // immediately before the client uses it.
  /**
   * Where `public/` objects are served from — an R2 public bucket URL or a
   * custom domain. Empty means public serving is not configured, and every
   * surface falls back to the drawn heroIcon instead.
   */
  S3_PUBLIC_BASE_URL: z.string().default(''),
  S3_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  // How long a presigned download URL stays valid.
  S3_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60),

  // ---- AI ----
  OPENAI_API_KEY: z.string().default(''),

  /**
   * Model per job, because they differ enormously in cost.
   *
   * Named to match what a person would guess when writing a .env by hand —
   * PARSE, GENERATE, VISION, WHISPER — rather than an internal tiering scheme
   * nobody outside this file knows about.
   */
  OPENAI_GENERATE_MODEL: z.string().default('gpt-4o'),
  /** The cheap one: parsing, and the gatekeeper that checks a photo is food. */
  OPENAI_PARSE_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_VISION_MODEL: z.string().default('gpt-4o'),
  OPENAI_WHISPER_MODEL: z.string().default('whisper-1'),
  /** Recipe photography. Only ever called from a background job. */
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  /**
   * Which AI provider the service uses.
   *   mock   — canned, deterministic answers from src/features/mock/data
   *   openai — the real API, which costs real money per call
   *   auto   — openai when a key is configured, mock otherwise
   * Defaults to auto so a developer with no key still gets a working app.
   */
  AI_PROVIDER: z.enum(['auto', 'mock', 'openai']).default('auto'),

  RESEND_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().default('KinniJije <onboarding@resend.dev>'),

  // ---- Email (Cloudflare Email Sending) ----
  // The second provider. Which one is actually used is an operator decision
  // stored in the database, not here — see lib/mail/mail-provider.model.ts.
  // These are only the credentials; empty means "cloudflare is not available",
  // and selecting it anyway fails the send loudly rather than silently
  // falling back to Resend.
  CLOUDFLARE_EMAIL_SENDING_TOKEN: z.string().default(''),
  CLOUDFLARE_ACCOUNT_ID: z.string().default(''),
  /**
   * Cloudflare will only send from a domain onboarded to Email Sending, so it
   * needs its own from-address: MAIL_FROM's default points at resend.dev,
   * which Cloudflare would reject.
   */
  CLOUDFLARE_MAIL_FROM: z.string().default('chef@kinnijije.xyz'),
  /**
   * The provider used when the database has no row yet — the seed value, not
   * the live setting. Operators switch providers from the console at runtime;
   * this only decides where a fresh install starts.
   */
  MAIL_PROVIDER: z.enum(['resend', 'cloudflare']).default('resend'),
  /**
   * Where the web app lives. Every link in an email is built from this — a
   * password-reset link that points at the API is a dead end.
   */
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** A box a person can actually reply to. Never a no-reply address. */
  MAIL_REPLY_TO: z.string().default('chef@kinnijije.xyz'),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),

  // ---- Analytics ----
  /**
   * Comma-separated provider list, e.g. `mixpanel,console`. EMPTY IS VALID and
   * is the default: the service becomes a no-op and the app behaves identically,
   * which is what keeps tests, CI and fresh clones quiet with no special-casing.
   */
  ANALYTICS_PROVIDERS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0),
    ),
  /** Required only if `mixpanel` is in the provider list. */
  MIXPANEL_TOKEN: z.string().default(''),
  /**
   * Salt for the anonymous distinct id on public routes.
   *
   * Without it, `sha256(ip + date)` is trivially reversible — an attacker can
   * hash every address in a /24 in milliseconds — which would turn a privacy
   * measure into a durable tracking id. Empty means anonymous server events are
   * skipped entirely rather than sent with a weak identifier.
   */
  ANALYTICS_ANON_SALT: z.string().default(''),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // The logger depends on env, so it does not exist yet. This is the one
  // sanctioned write to stderr in the codebase.
  process.stderr.write(`Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const IS_PRODUCTION = env.NODE_ENV === 'production';
export const IS_TEST = env.NODE_ENV === 'test';
