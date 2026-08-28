import { model, Schema, type HydratedDocument } from 'mongoose';

import { newId } from '@lib/ids.js';

export interface ChatMessageAttributes {
  _id: string;
  ownerId: string;
  role: 'user' | 'assistant';
  text: string;
  /** The structured reply, for re-rendering history exactly as it appeared. */
  payload: unknown;
  /**
   * True when this turn was produced by the MOCK provider.
   *
   * Canned answers must never become context for a real model: it reads them
   * as things it actually said, and starts agreeing with meals that were never
   * suggested and stock nobody has. Kept rather than deleted so the history a
   * person sees does not silently lose messages — it is filtered out of the
   * model's context only.
   */
  mocked: boolean;
  createdAt: Date;
}

const chatMessageSchema = new Schema<ChatMessageAttributes>(
  {
    _id: { type: String, default: () => newId('chat') },
    ownerId: { type: String, required: true, index: true },
    role: { type: String, required: true, enum: ['user', 'assistant'] },
    text: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: null },
    mocked: { type: Boolean, required: true, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'chat_messages' },
);

chatMessageSchema.index({ ownerId: 1, createdAt: -1 });

export type ChatMessageDocument = HydratedDocument<ChatMessageAttributes>;
export const ChatMessageModel = model<ChatMessageAttributes>('ChatMessage', chatMessageSchema);
