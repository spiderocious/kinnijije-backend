/**
 * Seeds the local database with one account per role so admin surfaces can be
 * exercised without hand-crafting tokens.
 *
 * Idempotent: re-running updates the existing accounts rather than failing on
 * the unique email index.
 */
import argon2 from 'argon2';

import { connectDatabase, disconnectDatabase } from '../src/lib/db/connection.js';
import { UserModel } from '../src/features/users/users.model.js';
import { USER_ROLES, USER_STATUSES } from '../src/shared/constants/roles.js';
import type { UserRole, UserStatus } from '../src/shared/constants/roles.js';

const PASSWORD = 'Pass123!word';

const SEEDS: { email: string; name: string; role: UserRole; status: UserStatus }[] = [
  { email: 'root@test.test', name: 'Root', role: USER_ROLES.SUPER_ADMIN, status: USER_STATUSES.ACTIVE },
  { email: 'admin@test.test', name: 'Admin', role: USER_ROLES.ADMIN, status: USER_STATUSES.ACTIVE },
  { email: 'mod@test.test', name: 'Mod', role: USER_ROLES.MODERATOR, status: USER_STATUSES.ACTIVE },
  { email: 'active@test.test', name: 'Active User', role: USER_ROLES.USER, status: USER_STATUSES.ACTIVE },
  { email: 'pending@test.test', name: 'Pending User', role: USER_ROLES.USER, status: USER_STATUSES.PENDING },
  { email: 'suspended@test.test', name: 'Suspended User', role: USER_ROLES.USER, status: USER_STATUSES.SUSPENDED },
  { email: 'banned@test.test', name: 'Banned User', role: USER_ROLES.USER, status: USER_STATUSES.BANNED },
];

async function main(): Promise<void> {
  await connectDatabase();

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  for (const seed of SEEDS) {
    await UserModel.findOneAndUpdate(
      { email: seed.email },
      {
        $set: {
          name: seed.name,
          role: seed.role,
          status: seed.status,
          passwordHash,
          emailVerifiedAt: seed.status === USER_STATUSES.ACTIVE ? new Date() : null,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      },
      { upsert: true, new: true },
    ).exec();

    console.log(`  ${seed.email.padEnd(24)} ${seed.role.padEnd(12)} ${seed.status}`);
  }

  console.log(`\nAll seeded accounts use password: ${PASSWORD}`);
  await disconnectDatabase();
}

main().catch((error: unknown) => {
  console.error('seed failed', error);
  process.exit(1);
});
