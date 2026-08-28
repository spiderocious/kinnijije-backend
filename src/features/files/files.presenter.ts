import { presignDownload, isStorageConfigured } from '@lib/storage/s3.js';
import { isoOrNull } from '@lib/dates.js';

import type { FileDocument, FilePurpose, FileStatus } from './files.model.js';

/**
 * The wire shape of a file.
 *
 * Note what is absent: the storage **key**. It is an internal identifier, and
 * publishing it invites a client to construct its own URLs against the bucket.
 * What crosses the wire is a freshly signed, expiring `url`.
 */
export interface FileView {
  id: string;
  purpose: FilePurpose;
  status: FileStatus;
  content_type: string;
  size: number | null;
  original_filename: string | null;
  /** Presigned, and short-lived. Never cache or persist this on the client. */
  url: string | null;
  url_expires_in: number;
  uploaded_at: string | null;
  created_at: string | null;
}

/**
 * Turns a stored key into a signed URL at the moment of responding.
 *
 * This is the ONLY place a key becomes a URL, and it is why no URL is ever
 * written to the database: a presigned URL expires, so a stored one is a link
 * that is guaranteed to be broken by the time somebody clicks it.
 *
 * A pending file has no bytes yet, so it presents a null url rather than a
 * signature that would 404.
 */
export async function toFileView(doc: FileDocument, downloadTtlSeconds: number): Promise<FileView> {
  const url =
    doc.status === 'ready' && isStorageConfigured() ? await presignDownload(doc.key) : null;

  return {
    id: doc._id,
    purpose: doc.purpose,
    status: doc.status,
    content_type: doc.contentType,
    size: doc.size,
    original_filename: doc.originalFilename,
    url,
    url_expires_in: downloadTtlSeconds,
    uploaded_at: isoOrNull(doc.uploadedAt),
    created_at: isoOrNull(doc.createdAt),
  };
}

/**
 * Signs a whole page in parallel. Sequential signing of fifty files is fifty
 * round-trips of latency for work that has no ordering constraint.
 */
export async function toFileViews(
  docs: readonly FileDocument[],
  downloadTtlSeconds: number,
): Promise<FileView[]> {
  return Promise.all(docs.map((doc) => toFileView(doc, downloadTtlSeconds)));
}
