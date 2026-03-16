import type { QueryHandler } from "../types";
import { RedgestError } from "../../errors";
import type { SearchOptions } from "../../search/types";

export const handleFindSimilar: QueryHandler<"FindSimilar"> = async (
  params,
  ctx,
) => {
  if (!ctx.searchService) {
    throw new RedgestError("INTERNAL_ERROR", "SearchService not available");
  }
  const options: SearchOptions = {
    organizationId: ctx.organizationId,
    limit: params.limit ?? 5,
    subreddit: params.subreddit,
  };
  return ctx.searchService.findSimilar(params.postId, options);
};
