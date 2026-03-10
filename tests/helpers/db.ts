import { prisma, type PrismaClient } from "@redgest/db";
import { execSync } from "node:child_process";

let _db: PrismaClient | null = null;

/**
 * Get a PrismaClient connected to the test database.
 * Runs migrations on first call.
 */
export async function getTestDb(): Promise<PrismaClient> {
  if (_db) return _db;

  // Run migrations against the test DB
  execSync("pnpm --filter @redgest/db exec prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env },
  });

  _db = prisma;
  return _db;
}

/** Truncate all tables (order matters for FK constraints). */
export async function truncateAll(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`TRUNCATE "digest_posts" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "digests" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "post_summaries" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "post_comments" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "posts" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "events" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "jobs" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "subreddits" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "config" CASCADE`);
}

/** Disconnect from the test database. */
export async function teardownTestDb(): Promise<void> {
  if (_db) {
    await _db.$disconnect();
    _db = null;
  }
}
