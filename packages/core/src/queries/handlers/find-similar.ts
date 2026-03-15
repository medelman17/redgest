import type { QueryHandler } from "../types.js";
import { RedgestError } from "../../errors.js";
import type { SearchOptions } from "../../search/types.js";

// TODO: Add organizationId to SearchOptions and pass ctx.organizationId
// so the raw SQL search service can filter through the job table for tenant isolation.
export const handleFindSimilar: QueryHandler<"FindSimilar"> = async (
  params,
  ctx,
) => {
  if (!ctx.searchService) {
    throw new RedgestError("INTERNAL_ERROR", "SearchService not available");
  }
  const options: SearchOptions = {
    limit: params.limit ?? 5,
    subreddit: params.subreddit,
  };
  return ctx.searchService.findSimilar(params.postId, options);
};
