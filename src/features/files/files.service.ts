import { env } from '@app/env.js';
import { logger } from '@lib/logger/index.js';
import { clampLimit } from '@lib/pagination.js';
import { fail, ok, type ServiceResult } from '@lib/service-result.js';
import {
  buildObjectKey,
  isStorageConfigured,
  objectExists,
  presignUpload,
} from '@lib/storage/s3.js';
import { ERROR_CODES } from '@shared/constants/error-codes.js';
import { HTTP_STATUS } from '@shared/constants/http-status.js';
import { MESSAGE_KEYS } from '@shared/messages/keys.js';

import type { FilePurpose } from './files.model.js';
import { toFileView, toFileViews, type FileView } from './files.presenter.js';
import type { FilesRepository } from './files.repo.js';
import { filesRepository } from './files.repo.js';
import type { ListFilesQuery, RequestUploadInput } from './files.schema.js';

export interface UploadTicket {
  file: FileView;
  /** Presigned PUT. The client uploads the bytes here, not to this API. */
  upload_url: string;
  upload_expires_in: number;
  /** Headers the client MUST send on the PUT, or the signature will not match. */
  required_headers: Record<string, string>;
}

/**
 * Uploads are deliberately three separate steps:
 *
 *   1. ask for a ticket   → a row exists, status `pending`
 *   2. PUT to S3 directly → bytes never touch this server
 *   3. confirm            → we HEAD the object and flip it to `ready`
 *
 * The point of the split is that the FILE is a first-class thing that outlives
 * whatever it was uploaded for. Sending a photo straight into an AI call would
 * mean the user can never see it again — no gallery, no re-processing, no
 * evidence of what a read was based on.
 */
export class FilesService {
  private constructor(private readonly repo: FilesRepository = filesRepository) {}

  private static instance: FilesService | undefined;

  static getInstance(): FilesService {
    FilesService.instance ??= new FilesService();
    return FilesService.instance;
  }

  async requestUpload(
    ownerId: string,
    input: RequestUploadInput,
  ): Promise<ServiceResult<UploadTicket>> {
    if (!isStorageConfigured()) {
      return fail(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        MESSAGE_KEYS.files.STORAGE_UNAVAILABLE,
        HTTP_STATUS.UNAVAILABLE,
        { rejectionReason: 'storage_not_configured' },
      );
    }

    const key = buildObjectKey({
      purpose: input.purpose,
      ownerId,
      filename: input.filename,
    });

    // The row is written BEFORE the URL is handed out, so an upload that is
    // started and abandoned still leaves a trace we can show and clean up.
    const doc = await this.repo.create({
      ownerId,
      key,
      purpose: input.purpose as FilePurpose,
      contentType: input.content_type,
      originalFilename: input.filename,
    });

    const { url, expiresInSeconds } = await presignUpload({
      key,
      contentType: input.content_type,
      contentLength: input.size_bytes,
    });

    logger.info('upload ticket issued', { file_id: doc._id, purpose: input.purpose });

    return ok({
      file: await toFileView(doc, env.S3_DOWNLOAD_URL_TTL_SECONDS),
      upload_url: url,
      upload_expires_in: expiresInSeconds,
      // Signed into the URL — a PUT without these is rejected by the bucket.
      required_headers: {
        'Content-Type': input.content_type,
        'Content-Length': String(input.size_bytes),
      },
    });
  }

  /**
   * Confirms the bytes arrived.
   *
   * The server never sees the PUT, so it asks the bucket directly rather than
   * trusting the client's word. Without this a row could claim a file that was
   * never uploaded, and every later read of it would 404.
   */
  async confirmUpload(fileId: string, ownerId: string): Promise<ServiceResult<FileView>> {
    const doc = await this.repo.findOwnedById(fileId, ownerId);
    if (doc === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.files.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // Idempotent: confirming twice is a retry, not an error.
    if (doc.status === 'ready') {
      return ok(await toFileView(doc, env.S3_DOWNLOAD_URL_TTL_SECONDS));
    }

    const { exists, size } = await objectExists(doc.key);
    if (!exists) {
      return fail(
        ERROR_CODES.FILE_NOT_UPLOADED,
        MESSAGE_KEYS.files.NOT_UPLOADED,
        HTTP_STATUS.CONFLICT,
        { rejectionReason: 'object_missing_in_bucket' },
      );
    }

    const updated = await this.repo.markReady(fileId, size);
    if (updated === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.files.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    logger.info('upload confirmed', { file_id: fileId, size_bytes: size });
    return ok(await toFileView(updated, env.S3_DOWNLOAD_URL_TTL_SECONDS));
  }

  async getOne(fileId: string, ownerId: string): Promise<ServiceResult<FileView>> {
    const doc = await this.repo.findOwnedById(fileId, ownerId);
    if (doc === null) {
      return fail(ERROR_CODES.NOT_FOUND, MESSAGE_KEYS.files.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    return ok(await toFileView(doc, env.S3_DOWNLOAD_URL_TTL_SECONDS));
  }

  /** The gallery: everything this person ever uploaded, newest first. */
  async list(
    ownerId: string,
    query: ListFilesQuery,
  ): Promise<ServiceResult<{ files: FileView[]; nextCursor: string | null; hasMore: boolean }>> {
    const page = await this.repo.list({
      ownerId,
      limit: clampLimit(query.limit),
      ...(query.cursor !== undefined && { cursor: query.cursor }),
      ...(query.purpose !== undefined && { purpose: query.purpose as FilePurpose }),
    });

    return ok({
      files: await toFileViews(page.files, env.S3_DOWNLOAD_URL_TTL_SECONDS),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  }
}

export const filesService = FilesService.getInstance();
