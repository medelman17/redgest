import type { QueryHandler } from "../types.js";
import type { SearchOptions } from "../../search/types.js";

export const handleFindSimilar: QueryHandler<"FindSimilar"> = async (
  params,
  ctx,
) => {
  if (!ctx.searchService) {
    throw new Error("SearchService not available");
  }
  const options: SearchOptions = {
    limit: params.limit ?? 5,
    subreddit: params.subreddit,
  };
  return ctx.searchService.findSimilar(params.postId, options);
};
