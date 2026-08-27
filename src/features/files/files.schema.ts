import { z } from 'zod';

import { MAX_PAGE_SIZE } from '@lib/pagination.js';

import { ALL_FILE_PURPOSES } from './files.model.js';

/**
 * What a client may upload. An open-ended content type would let the bucket
 * become a host for anything, so the allowed set is explicit per purpose.
 */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export const AUDIO_TYPES = ['audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg'] as const;

/** 15 MB. A kitchen photo from a phone is comfortably under this. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const RequestUploadSchema = z.object({
  purpose: z.enum(ALL_FILE_PURPOSES as [string, ...string[]]),
  content_type: z.enum([...IMAGE_TYPES, ...AUDIO_TYPES] as [string, ...string[]]),
  filename: z.string().min(1).max(255).trim(),
  // Declared up front so it can be signed into the URL — the bucket then
  // rejects an oversized body itself, rather than us discovering it after.
  size_bytes: z.coerce.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type RequestUploadInput = z.infer<typeof RequestUploadSchema>;

export const FileIdParamSchema = z.object({
  fileId: z.string().min(1),
});

export const ListFilesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
  purpose: z.enum(ALL_FILE_PURPOSES as [string, ...string[]]).optional(),
});
export type ListFilesQuery = z.infer<typeof ListFilesQuerySchema>;
