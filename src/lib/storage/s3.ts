import { randomBytes } from 'node:crypto';

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@app/env.js';
import { logger } from '@lib/logger/index.js';

/**
 * The object-storage primitive.
 *
 * Two rules the rest of the codebase depends on:
 *
 *  1. **Bytes never pass through this API.** The client presigns a URL and
 *     uploads straight to S3. A server that proxies uploads pays for the
 *     bandwidth twice and falls over on a large file.
 *  2. **Only the key is ever persisted.** A presigned URL expires; storing one
 *     in the database guarantees a dead link later. Keys are converted to URLs
 *     at the moment of responding — see `presentKey` in the files feature.
 *
 * Works against any S3-compatible endpoint (AWS, Cloudflare R2, MinIO).
 */

const isConfigured =
  env.S3_ENDPOINT.length > 0 &&
  env.S3_BUCKET.length > 0 &&
  env.S3_ACCESS_KEY_ID.length > 0 &&
  env.S3_SECRET_ACCESS_KEY.length > 0;

export const isStorageConfigured = (): boolean => isConfigured;

const client: S3Client | null = isConfigured
  ? new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      // R2 and MinIO serve the bucket as a path segment rather than a
      // subdomain; AWS tolerates this too, so it is safe as a single setting.
      forcePathStyle: true,
    })
  : null;

if (!isConfigured) {
  logger.warn('object storage is not configured — uploads will be refused', {
    hint: 'set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
  });
}

function requireClient(): S3Client {
  if (client === null) {
    throw new Error('Object storage is not configured');
  }
  return client;
}

/**
 * Builds the key an object is stored under.
 *
 * Shape: `<purpose>/<ownerId>/<time>-<random>.<ext>`
 *
 * Owner-scoped so a listing is a cheap prefix query, and time-prefixed so those
 * listings come back newest-last without a sort. The random suffix means two
 * uploads in the same millisecond cannot collide.
 */
export function buildObjectKey(input: {
  purpose: string;
  ownerId: string;
  filename: string;
}): string {
  const extension = extensionOf(input.filename);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nonce = randomBytes(6).toString('hex');
  return `${input.purpose}/${input.ownerId}/${stamp}-${nonce}${extension}`;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  // Guard the extension: it lands in a key, and an unbounded or odd-charactered
  // one is a path-traversal and tooling hazard.
  const raw = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(raw) ? `.${raw}` : '';
}

/** A presigned PUT the client uploads to directly. */
export async function presignUpload(input: {
  key: string;
  contentType: string;
  contentLength?: number;
}): Promise<{ url: string; expiresInSeconds: number }> {
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: input.key,
    ContentType: input.contentType,
    // Signed into the URL, so a client cannot quietly upload something larger
    // than it declared.
    ...(input.contentLength !== undefined && { ContentLength: input.contentLength }),
  });

  const url = await getSignedUrl(requireClient(), command, {
    expiresIn: env.S3_UPLOAD_URL_TTL_SECONDS,
  });

  return { url, expiresInSeconds: env.S3_UPLOAD_URL_TTL_SECONDS };
}

/** A presigned GET, generated fresh each time a key is served to a client. */
export async function presignDownload(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
  return getSignedUrl(requireClient(), command, {
    expiresIn: env.S3_DOWNLOAD_URL_TTL_SECONDS,
  });
}

/**
 * Whether the object actually landed.
 *
 * The client uploads out of band, so the server never observes the PUT. This is
 * how a record moves from "we handed out a URL" to "the file exists" — without
 * it, a database row can claim a file that was never uploaded.
 */
export async function objectExists(key: string): Promise<{ exists: boolean; size: number | null }> {
  try {
    const head = await requireClient().send(
      new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    return { exists: true, size: head.ContentLength ?? null };
  } catch {
    // A 404 from HEAD is the ordinary "not uploaded yet" answer, not a fault.
    return { exists: false, size: null };
  }
}
