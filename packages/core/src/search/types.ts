export interface SearchOptions {
  organizationId?: string;
  subreddit?: string;
  since?: Date;
  sentiment?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  postId: string;
  redditId: string;
  subreddit: string;
  title: string;
  score: number;
  summarySnippet: string | null;
  matchHighlights: string[];
  relevanceRank: number;
  sentiment: string | null;
  digestId: string | null;
  digestDate: Date | null;
}

export interface SearchService {
  searchByKeyword(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  searchBySimilarity(embedding: number[], options?: SearchOptions): Promise<SearchResult[]>;
  findSimilar(postId: string, options?: SearchOptions): Promise<SearchResult[]>;
  searchHybrid(query: string, queryEmbedding: number[], options?: SearchOptions): Promise<SearchResult[]>;
}
