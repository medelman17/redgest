import { DEFAULT_PAGE_SIZE, type Paginated } from "./types";

/**
 * Build a Paginated result from a "fetch one extra" query result.
 *
 * Callers should `take: limit + 1` from the database, then pass the
 * raw items here. If we received more than `limit`, we know there's
 * another page and trim the extra item.
 *
 * @param items  Raw query results (may have limit+1 items)
 * @param limit  Requested page size
 * @param getCursor  Extract the cursor value from the last item
 */
export function paginate<T>(
  items: T[],
  limit: number,
  getCursor: (item: T) => string,
): Paginated<T> {
  const effectiveLimit = limit || DEFAULT_PAGE_SIZE;
  const hasMore = items.length > effectiveLimit;
  const page = hasMore ? items.slice(0, effectiveLimit) : items;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? getCursor(last) : null,
    hasMore,
  };
}
