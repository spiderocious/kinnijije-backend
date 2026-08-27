import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

/**
 * What a file is *for*. Kept as a small closed set rather than free text so a
 * listing can be filtered ("show me my shelf photos") and so a key's prefix is
 * predictable.
 */
export const FILE_PURPOSES = {
  SHELF_PHOTO: 'shelf_photo',
  RECEIPT: 'receipt',
  VOICE_NOTE: 'voice_note',
  RECIPE_HERO: 'recipe_hero',
  AVATAR: 'avatar',
} as const;

export type FilePurpose = (typeof FILE_PURPOSES)[keyof typeof FILE_PURPOSES];

export const ALL_FILE_PURPOSES: readonly FilePurpose[] = Object.values(FILE_PURPOSES);

/**
 * The upload lifecycle. A row exists from the moment a URL is handed out, which
 * is what makes "show me everything I ever uploaded" possible — including the
 * ones that never finished.
 *
 *   pending  — a URL was issued; the bytes may or may not have arrived
 *   ready    — confirmed present in the bucket
 *   expired  — the URL lapsed and nothing was ever uploaded
 */
export const FILE_STATUSES = {
  PENDING: 'pending',
  READY: 'ready',
  EXPIRED: 'expired',
} as const;

export type FileStatus = (typeof FILE_STATUSES)[keyof typeof FILE_STATUSES];

export interface FileAttributes {
  _id: string;
  ownerId: string;
  /** The S3 object key. The ONLY storage identifier we persist — never a URL. */
  key: string;
  purpose: FilePurpose;
  status: FileStatus;
  contentType: string;
  /** Bytes, from the bucket once confirmed. Null while pending. */
  size: number | null;
  originalFilename: string | null;
  /** When the bytes were confirmed present. */
  uploadedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<FileAttributes>(
  {
    _id: { type: String, default: () => newId('file') },
    ownerId: { type: String, required: true, index: true },
    // Unique: one row per object, so confirming twice cannot fork the record.
    key: { type: String, required: true, unique: true },
    purpose: { type: String, required: true, enum: ALL_FILE_PURPOSES, index: true },
    status: { type: String, required: true, enum: Object.values(FILE_STATUSES), default: FILE_STATUSES.PENDING, index: true },
    contentType: { type: String, required: true },
    size: { type: Number, default: null },
    originalFilename: { type: String, default: null },
    uploadedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: 'files' },
);

// The gallery query: one owner's files, newest first, with the _id tiebreak
// the cursor needs.
fileSchema.index({ ownerId: 1, createdAt: -1, _id: -1 });

export type FileDocument = HydratedDocument<FileAttributes>;

export const FileModel = model<FileAttributes>('File', fileSchema);
