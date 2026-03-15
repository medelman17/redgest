import type { QueryHandler } from "../types.js";
import { RedgestError } from "../../errors.js";
import { parseDuration } from "../../utils/duration.js";
import type { SearchOptions } from "../../search/types.js";

// TODO: Add organizationId to SearchOptions and pass ctx.organizationId
// so the raw SQL search service can filter through the job table for tenant isolation.
export const handleSearchDigests: QueryHandler<"SearchDigests"> = async (
  params,
  ctx,
) => {
  if (!ctx.searchService) {
    throw new RedgestError("INTERNAL_ERROR", "SearchService not available");
  }
  const options: SearchOptions = {
    limit: params.limit ?? 10,
    subreddit: params.subreddit,
  };
  if (params.since) {
    options.since = new Date(Date.now() - parseDuration(params.since));
  }
  return ctx.searchService.searchByKeyword(params.query, options);
};
