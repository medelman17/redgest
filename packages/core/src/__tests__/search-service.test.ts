import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@redgest/db";
import { createSearchService } from "../search/service";

function stub<T>(): T {
  const empty = {};
  return empty as T;
}

describe("SearchService", () => {
  // These tests use a mock DB with $queryRaw returning empty results.
  // Integration tests against a real DB will verify actual SQL behavior.
  function createMockDb() {
    return {
      ...stub<PrismaClient>(),
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
  }

  describe("searchByKeyword", () => {
    it("returns empty array when no matches", async () => {
      const mockDb = createMockDb();
      const service = createSearchService(mockDb);
      const results = await service.searchByKeyword("nonexistent-xyz-query");
      expect(results).toEqual([]);
    });
  });

  describe("searchHybrid", () => {
    it("returns empty array with no embedding input", async () => {
      const mockDb = createMockDb();
      const service = createSearchService(mockDb);
      // Empty embedding → keyword-only path, returns empty
      const results = await service.searchHybrid("test", [], { limit: 5 });
      expect(Array.isArray(results)).toBe(true);
    });
  });
});
