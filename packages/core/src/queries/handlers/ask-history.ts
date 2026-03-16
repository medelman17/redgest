import type { QueryHandler } from "../types";
import { RedgestError } from "../../errors";
import { parseDuration } from "../../utils/duration";
import type { SearchOptions } from "../../search/types";

export const handleAskHistory: QueryHandler<"AskHistory"> = async (
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

  // Try hybrid search if OpenAI embedding is available
  if (process.env.OPENAI_API_KEY) {
    try {
      const { generateEmbedding } = await import("@redgest/llm");
      const embResult = await generateEmbedding(params.question);
      return ctx.searchService.searchHybrid(params.question, embResult.data, options);
    } catch {
      // Fall back to keyword search if embedding fails
    }
  }

  return ctx.searchService.searchByKeyword(params.question, options);
};
