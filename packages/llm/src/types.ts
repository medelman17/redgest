export interface CandidatePost {
  index: number;
  redditId: string;
  title: string;
  subreddit: string;
  score: number;
  numComments: number;
  ageHours: number;
  flair?: string;
  selftextPreview?: string;
  contentType: "text" | "link" | "image" | "video" | "other";
  url?: string;
}

export interface SummarizationInput {
  post: {
    redditId: string;
    title: string;
    subreddit: string;
    author: string;
    score: number;
    numComments: number;
    selftext: string;
    contentType: "text" | "link" | "image" | "video" | "other";
    url?: string;
  };
  comments: Array<{
    author: string;
    body: string;
    score: number;
  }>;
  insightPrompts: string[];
}
