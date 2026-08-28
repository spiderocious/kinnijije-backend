import type { FilterQuery } from 'mongoose';
import { isoOrNull } from '@lib/dates.js';

import { decodeCursor, encodeCursor, type Cursor } from '@lib/pagination.js';
import type { UserRole, UserStatus } from '@shared/constants/roles.js';

import { UserModel, type UserDocument } from './users.model.js';

export interface ListUsersFilter {
  role?: UserRole;
  status?: UserStatus;
  cursor?: string;
  limit: number;
}

export interface ListUsersPage {
  users: UserDocument[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class UsersRepository {
  private static instance: UsersRepository | undefined;

  static getInstance(): UsersRepository {
    UsersRepository.instance ??= new UsersRepository();
    return UsersRepository.instance;
  }

  findById(userId: string): Promise<UserDocument | null> {
    return UserModel.findById(userId).exec();
  }

  /**
   * Sorted newest-first by (createdAt, _id). The compound sort matches the
   * compound index on the model, and the _id tiebreak is what makes the cursor
   * total — two users created in the same millisecond would otherwise make
   * the page boundary ambiguous.
   */
  async list(filter: ListUsersFilter): Promise<ListUsersPage> {
    const query: FilterQuery<UserDocument> = {};
    if (filter.role !== undefined) query.role = filter.role;
    if (filter.status !== undefined) query.status = filter.status;

    const cursor: Cursor | null = decodeCursor(filter.cursor);
    if (cursor !== null) {
      const lastCreatedAt = new Date(cursor.last_sort_key);
      if (!Number.isNaN(lastCreatedAt.getTime())) {
        // Strictly "older than the last item", with the id breaking ties.
        query.$or = [
          { createdAt: { $lt: lastCreatedAt } },
          { createdAt: lastCreatedAt, _id: { $lt: cursor.last_id } },
        ];
      }
    }

    // One extra row is fetched purely to learn whether another page exists,
    // then dropped. A second count query would be a second full scan.
    const rows = await UserModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(filter.limit + 1)
      .exec();

    const hasMore = rows.length > filter.limit;
    const users = hasMore ? rows.slice(0, filter.limit) : rows;
    const last = users.at(-1);

    return {
      users,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ last_id: last._id, last_sort_key: isoOrNull(last.createdAt) ?? new Date(0).toISOString() })
          : null,
    };
  }

  async updateProfile(
    userId: string,
    update: { name?: string | undefined },
  ): Promise<UserDocument | null> {
    return UserModel.findOneAndUpdate({ _id: userId }, { $set: update }, { new: true }).exec();
  }

  async deleteById(userId: string): Promise<void> {
    await UserModel.deleteOne({ _id: userId }).exec();
  }

  async updateStatus(
    userId: string,
    status: UserStatus,
    reason: string | null,
  ): Promise<UserDocument | null> {
    return UserModel.findOneAndUpdate(
      { _id: userId },
      { $set: { status, statusReason: reason } },
      { new: true },
    ).exec();
  }

  async updateRole(userId: string, role: UserRole): Promise<UserDocument | null> {
    return UserModel.findOneAndUpdate({ _id: userId }, { $set: { role } }, { new: true }).exec();
  }
}

export const usersRepository = UsersRepository.getInstance();
