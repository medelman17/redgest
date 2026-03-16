import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@redgest/db";
import { findPreviousPostIds } from "../pipeline/dedup";

function makeDb(mockFindMany: ReturnType<typeof vi.fn>) {
  const db = { digest: { findMany: mockFindMany } };
  return db as unknown as PrismaClient;
}

describe("findPreviousPostIds", () => {
  it("returns empty set when no digests exist", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const db = makeDb(mockFindMany);

    const result = await findPreviousPostIds(db);

    expect(result.size).toBe(0);
    expect(mockFindMany).toHaveBeenCalledWith({
      take: 3,
      orderBy: { createdAt: "desc" },
      select: {
        digestPosts: {
          select: {
            post: {
              select: { redditId: true },
            },
          },
        },
      },
    });
  });

  it("collects redditIds from last N digests", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([
      {
        digestPosts: [
          { post: { redditId: "abc123" } },
          { post: { redditId: "def456" } },
        ],
      },
      {
        digestPosts: [{ post: { redditId: "ghi789" } }],
      },
    ]);
    const db = makeDb(mockFindMany);

    const result = await findPreviousPostIds(db);

    expect(result.size).toBe(3);
    expect(result.has("abc123")).toBe(true);
    expect(result.has("def456")).toBe(true);
    expect(result.has("ghi789")).toBe(true);
  });

  it("deduplicates across digests", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([
      { digestPosts: [{ post: { redditId: "same-id" } }] },
      { digestPosts: [{ post: { redditId: "same-id" } }] },
    ]);
    const db = makeDb(mockFindMany);

    const result = await findPreviousPostIds(db);

    expect(result.size).toBe(1);
  });

  it("respects custom digestCount parameter", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const db = makeDb(mockFindMany);

    await findPreviousPostIds(db, 5);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });
});
