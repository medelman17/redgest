import type { QueryHandler } from "../types";
import { RedgestError } from "../../errors";
import { parseDuration } from "../../utils/duration";
import type { SearchOptions } from "../../search/types";

export const handleSearchDigests: QueryHandler<"SearchDigests"> = async (
  params,
  ctx,
) => {
  if (!ctx.searchService) {
    throw new RedgestError("INTERNAL_ERROR", "SearchService not available");
  }
  const options: SearchOptions = {
    organizationId: ctx.organizationId,
    limit: params.limit ?? 10,
    subreddit: params.subreddit,
  };
  if (params.since) {
    options.since = new Date(Date.now() - parseDuration(params.since));
  }
  return ctx.searchService.searchByKeyword(params.query, options);
};
