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

/** Truncate all tables in a single atomic statement. */
export async function truncateAll(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    `TRUNCATE "config", "subreddits", "jobs", "events", "posts", "post_comments", "post_summaries", "digests", "digest_posts" CASCADE`,
  );
}

/** Disconnect from the test database. */
export async function teardownTestDb(): Promise<void> {
  if (_db) {
    await _db.$disconnect();
    _db = null;
  }
}
