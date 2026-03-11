import { describe, it, expect } from "vitest";
import { paginate } from "../queries/paginate.js";

describe("paginate", () => {
  const getCursor = (item: { id: string }) => item.id;

  it("returns all items when count <= limit", () => {
    const items = [{ id: "a" }, { id: "b" }];
    const result = paginate(items, 5, getCursor);

    expect(result.items).toEqual(items);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("trims extra item and sets hasMore when count > limit", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = paginate(items, 2, getCursor);

    expect(result.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("b");
  });

  it("handles empty items", () => {
    const result = paginate([], 10, getCursor);

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("handles exactly limit items (no extra)", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = paginate(items, 3, getCursor);

    expect(result.items).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("uses DEFAULT_PAGE_SIZE when limit is 0", () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ id: `item-${i}` }));
    const result = paginate(items, 0, getCursor);

    expect(result.items).toHaveLength(10);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("item-9");
  });
});
