import { describe, it, expect, vi } from "vitest";
import { createSearchService } from "../search/service.js";

function stub<T>(): T {
  const empty = {};
  return empty as T;
}

function makeMockDb() {
  const mockQueryRaw = vi.fn().mockResolvedValue([]);
  const db = stub<Parameters<typeof createSearchService>[0]>();
  Object.defineProperty(db, "$queryRaw", { value: mockQueryRaw });
  return { db, mockQueryRaw };
}

/**
 * Reconstruct the full SQL string from a $queryRaw tagged-template call.
 *
 * When $queryRaw is called as a tagged template `db.$queryRaw\`SELECT...\`` Prisma
 * passes a TemplateStringsArray as the first argument followed by Prisma.Sql
 * interpolated values.  The Prisma.Sql objects themselves contain nested `strings`
 * and `values` — we serialize them recursively so the test can assert on the
 * full text that would be sent to Postgres.
 */
function serializeSql(arg: unknown): string {
  if (Array.isArray(arg)) {
    // TemplateStringsArray — static string fragments
    return arg.join("");
  }
  if (arg && typeof arg === "object" && "strings" in arg && "values" in arg) {
    // Prisma.Sql object
    const sql = arg as { strings: string[]; values: unknown[] };
    let result = "";
    for (let i = 0; i < sql.strings.length; i++) {
      result += sql.strings[i] ?? "";
      if (i < sql.values.length) {
        result += serializeSql(sql.values[i]);
      }
    }
    return result;
  }
  return String(arg ?? "");
}

function extractFullSql(call: unknown[] | undefined): string {
  if (!call) return "";
  // First arg is the TemplateStringsArray; remaining args are interpolated Prisma.Sql objects
  const parts: string[] = [];
  for (const arg of call) {
    parts.push(serializeSql(arg));
  }
  return parts.join("");
}

describe("SearchService org filtering", () => {
  it("passes organizationId through to keyword search SQL", async () => {
    const { db, mockQueryRaw } = makeMockDb();
    const service = createSearchService(db);
    await service.searchByKeyword("test", { organizationId: "org_123" });

    expect(mockQueryRaw).toHaveBeenCalled();
    const call = mockQueryRaw.mock.calls[0];
    const sqlText = extractFullSql(call);
    expect(sqlText).toContain("organization_id");
  });

  it("does not filter by org when organizationId is not provided", async () => {
    const { db, mockQueryRaw } = makeMockDb();
    const service = createSearchService(db);
    await service.searchByKeyword("test", {});

    expect(mockQueryRaw).toHaveBeenCalled();
    const call = mockQueryRaw.mock.calls[0];
    const sqlText = extractFullSql(call);
    expect(sqlText).not.toContain("organization_id");
  });

  it("passes organizationId through to similarity search SQL", async () => {
    const { db, mockQueryRaw } = makeMockDb();
    const service = createSearchService(db);
    await service.searchBySimilarity([0.1, 0.2, 0.3], {
      organizationId: "org_456",
    });

    expect(mockQueryRaw).toHaveBeenCalled();
    const call = mockQueryRaw.mock.calls[0];
    const sqlText = extractFullSql(call);
    expect(sqlText).toContain("organization_id");
  });

  it("does not filter by org in similarity search when organizationId is not provided", async () => {
    const { db, mockQueryRaw } = makeMockDb();
    const service = createSearchService(db);
    await service.searchBySimilarity([0.1, 0.2, 0.3], {});

    expect(mockQueryRaw).toHaveBeenCalled();
    const call = mockQueryRaw.mock.calls[0];
    const sqlText = extractFullSql(call);
    expect(sqlText).not.toContain("organization_id");
  });

  it("performs org check as first query when findSimilar is called with organizationId", async () => {
    const mockQueryRaw = vi.fn();
    // First call: org check returns in_org=true
    mockQueryRaw.mockResolvedValueOnce([{ in_org: true }]);
    // Second call: embedding check returns has_embedding=true
    mockQueryRaw.mockResolvedValueOnce([{ has_embedding: true }]);
    // Third call: similarity query returns []
    mockQueryRaw.mockResolvedValueOnce([]);

    const db = stub<Parameters<typeof createSearchService>[0]>();
    Object.defineProperty(db, "$queryRaw", { value: mockQueryRaw });

    const service = createSearchService(db);
    await service.findSimilar("post_123", { organizationId: "org_789" });

    expect(mockQueryRaw).toHaveBeenCalledTimes(3);

    // First query should be the org check
    const firstCallSql = extractFullSql(mockQueryRaw.mock.calls[0]);
    expect(firstCallSql).toContain("organization_id");

    // Third query (similarity) should also filter by org
    const thirdCallSql = extractFullSql(mockQueryRaw.mock.calls[2]);
    expect(thirdCallSql).toContain("organization_id");
  });

  it("returns empty array from findSimilar when org check fails", async () => {
    const mockQueryRaw = vi.fn();
    // Org check returns in_org=false
    mockQueryRaw.mockResolvedValueOnce([{ in_org: false }]);

    const db = stub<Parameters<typeof createSearchService>[0]>();
    Object.defineProperty(db, "$queryRaw", { value: mockQueryRaw });

    const service = createSearchService(db);
    const results = await service.findSimilar("post_123", {
      organizationId: "org_999",
    });

    expect(results).toEqual([]);
    // Should only make 1 call (the org check), then short-circuit
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });
});

