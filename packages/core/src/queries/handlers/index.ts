import type { QueryType, QueryHandler } from "../types.js";
import { handleGetDigest } from "./get-digest.js";
import { handleGetDigestByJobId } from "./get-digest-by-job-id.js";
import { handleListDigests } from "./list-digests.js";
import { handleSearchDigests } from "./search-digests.js";
import { handleGetPost } from "./get-post.js";
import { handleSearchPosts } from "./search-posts.js";
import { handleGetRunStatus } from "./get-run-status.js";
import { handleListRuns } from "./list-runs.js";
import { handleListSubreddits } from "./list-subreddits.js";
import { handleGetConfig } from "./get-config.js";
import { handleGetLlmMetrics } from "./get-llm-metrics.js";
import { handleGetSubredditStats } from "./get-subreddit-stats.js";
import { handleCompareDigests } from "./compare-digests.js";
import { handleGetDeliveryStatus } from "./get-delivery-status.js";
import { handleFindSimilar } from "./find-similar.js";
import { handleAskHistory } from "./ask-history.js";
import { handleGetTrendingTopics } from "./get-trending-topics.js";
import { handleComparePeriods } from "./compare-periods.js";
import { handleListProfiles } from "./list-profiles.js";
import { handleGetProfile } from "./get-profile.js";

type QueryHandlerRegistry = {
  [K in QueryType]?: QueryHandler<K>;
};

export const queryHandlers: QueryHandlerRegistry = {
  GetDigest: handleGetDigest,
  GetDigestByJobId: handleGetDigestByJobId,
  ListDigests: handleListDigests,
  SearchDigests: handleSearchDigests,
  GetPost: handleGetPost,
  SearchPosts: handleSearchPosts,
  GetRunStatus: handleGetRunStatus,
  ListRuns: handleListRuns,
  ListSubreddits: handleListSubreddits,
  GetConfig: handleGetConfig,
  GetLlmMetrics: handleGetLlmMetrics,
  GetSubredditStats: handleGetSubredditStats,
  CompareDigests: handleCompareDigests,
  GetDeliveryStatus: handleGetDeliveryStatus,
  FindSimilar: handleFindSimilar,
  AskHistory: handleAskHistory,
  GetTrendingTopics: handleGetTrendingTopics,
  ComparePeriods: handleComparePeriods,
  ListProfiles: handleListProfiles,
  GetProfile: handleGetProfile,
};

export {
  handleGetDigest,
  handleGetDigestByJobId,
  handleListDigests,
  handleSearchDigests,
  handleGetPost,
  handleSearchPosts,
  handleGetRunStatus,
  handleListRuns,
  handleListSubreddits,
  handleGetConfig,
  handleGetLlmMetrics,
  handleGetSubredditStats,
  handleCompareDigests,
  handleGetDeliveryStatus,
  handleFindSimilar,
  handleAskHistory,
  handleGetTrendingTopics,
  handleComparePeriods,
  handleListProfiles,
  handleGetProfile,
};
