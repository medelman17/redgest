export interface DigestDeliveryData {
  digestId: string;
  createdAt: Date;
  subreddits: Array<{
    name: string;
    posts: Array<{
      title: string;
      permalink: string;
      score: number;
      summary: string;
      keyTakeaways: string[];
      insightNotes: string;
      commentHighlights: Array<{
        author: string;
        insight: string;
        score: number;
      }>;
    }>;
  }>;
}
