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
});

