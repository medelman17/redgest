import type { QueryType, QueryHandler } from "../types";
import { handleGetDigest } from "./get-digest";
import { handleGetDigestByJobId } from "./get-digest-by-job-id";
import { handleListDigests } from "./list-digests";
import { handleSearchDigests } from "./search-digests";
import { handleGetPost } from "./get-post";
import { handleSearchPosts } from "./search-posts";
import { handleGetRunStatus } from "./get-run-status";
import { handleListRuns } from "./list-runs";
import { handleListSubreddits } from "./list-subreddits";
import { handleGetConfig } from "./get-config";
import { handleGetLlmMetrics } from "./get-llm-metrics";
import { handleGetSubredditStats } from "./get-subreddit-stats";
import { handleCompareDigests } from "./compare-digests";
import { handleGetDeliveryStatus } from "./get-delivery-status";
import { handleFindSimilar } from "./find-similar";
import { handleAskHistory } from "./ask-history";
import { handleGetTrendingTopics } from "./get-trending-topics";
import { handleComparePeriods } from "./compare-periods";
import { handleListProfiles } from "./list-profiles";
import { handleGetProfile } from "./get-profile";
import { handleGetCrawlStatus } from "./get-crawl-status";

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
  GetCrawlStatus: handleGetCrawlStatus,
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
  handleGetCrawlStatus,
};
