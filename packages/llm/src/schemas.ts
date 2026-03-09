import { z } from "zod";

export const TriageResultSchema = z.object({
  selectedPosts: z
    .array(
      z.object({
        index: z
          .number()
          .int()
          .describe("Zero-based index of post from candidate list"),
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
