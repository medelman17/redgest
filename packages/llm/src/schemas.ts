import { z } from "zod";

export const TriageResultSchema = z.object({
  selectedPosts: z
    .array(
      z.object({
        index: z
          .number()
          .describe("Zero-based integer index of post from candidate list"),
        relevanceScore: z
          .number()
          .describe("1 (tangential) to 10 (core interest)"),
        rationale: z
          .string()
          .describe(
            "1-2 sentence explanation why post matters for THIS user",
          ),
      }),
    )
    .describe("Top posts ordered by relevance, most relevant first"),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

export const PostSummarySchema = z.object({
  summary: z
    .string()
    .describe(
      "2-4 sentence executive summary. Lead with key finding. No filler.",
    ),
  keyTakeaways: z
    .array(
      z
        .string()
        .describe(
          "One concrete fact, technique, or finding — single sentence",
        ),
    )
    .describe("3-5 key takeaways from post and discussion"),
  insightNotes: z
    .string()
    .describe(
      "Specific, actionable connections to user interests. MUST cite details from the post. Separate distinct notes with blank lines.",
    ),
  communityConsensus: z
    .string()
    .nullable()
    .describe(
      "What top comments agree/disagree about. Null if no comments.",
    ),
  commentHighlights: z
    .array(
      z.object({
        author: z.string().describe("Reddit username"),
        insight: z
          .string()
          .describe("Key point from comment, 1-2 sentences"),
        score: z.number().describe("Comment upvote score"),
      }),
    )
    .describe("2-4 most insightful comments"),
  sentiment: z
    .enum(["positive", "negative", "neutral", "mixed"])
    .describe("Overall sentiment of post and discussion"),
  relevanceScore: z
    .number()
    .describe("How relevant to user interests: 1 (low) to 10 (high)"),
  contentType: z
    .enum(["text", "link", "image", "video", "other"])
    .describe("Type of Reddit post"),
  notableLinks: z
    .array(z.string())
    .describe("Important URLs/resources mentioned. Empty if none."),
});

export type PostSummary = z.infer<typeof PostSummarySchema>;
