import type { FilterQuery } from 'mongoose';
import { isoOrNull } from '@lib/dates.js';

import { decodeCursor, encodeCursor } from '@lib/pagination.js';

import { FileModel, type FileDocument, type FilePurpose } from './files.model.js';

export class FilesRepository {
  private static instance: FilesRepository | undefined;

  static getInstance(): FilesRepository {
    FilesRepository.instance ??= new FilesRepository();
    return FilesRepository.instance;
  }

  create(input: {
    ownerId: string;
    key: string;
    purpose: FilePurpose;
    contentType: string;
    originalFilename: string;
  }): Promise<FileDocument> {
    return FileModel.create(input);
  }

  findById(fileId: string): Promise<FileDocument | null> {
    return FileModel.findById(fileId).exec();
  }

  /** Scoped by owner: one person must never resolve another's file by guessing an id. */
  findOwnedById(fileId: string, ownerId: string): Promise<FileDocument | null> {
    return FileModel.findOne({ _id: fileId, ownerId }).exec();
  }

  markReady(fileId: string, size: number | null): Promise<FileDocument | null> {
    return FileModel.findOneAndUpdate(
      { _id: fileId },
      { $set: { status: 'ready', size, uploadedAt: new Date() } },
      { new: true },
    ).exec();
  }

  async list(input: {
    ownerId: string;
    limit: number;
    cursor?: string;
    purpose?: FilePurpose;
  }): Promise<{ files: FileDocument[]; nextCursor: string | null; hasMore: boolean }> {
    const query: FilterQuery<FileDocument> = { ownerId: input.ownerId };
    if (input.purpose !== undefined) query.purpose = input.purpose;

    const cursor = decodeCursor(input.cursor);
    if (cursor !== null) {
      const last = new Date(cursor.last_sort_key);
      if (!Number.isNaN(last.getTime())) {
        query.$or = [
          { createdAt: { $lt: last } },
          { createdAt: last, _id: { $lt: cursor.last_id } },
        ];
      }
    }

    // One extra row purely to learn whether another page exists.
    const rows = await FileModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(input.limit + 1)
      .exec();

    const hasMore = rows.length > input.limit;
    const files = hasMore ? rows.slice(0, input.limit) : rows;
    const last = files.at(-1);

    return {
      files,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ last_id: last._id, last_sort_key: isoOrNull(last.createdAt) })
          : null,
    };
  }
}

export const filesRepository = FilesRepository.getInstance();
