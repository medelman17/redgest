import { z } from "zod";

/** Validates rows returned by $queryRaw for keyword/similarity search. */
export const RawSearchRowSchema = z.object({
  post_id: z.string(),
  reddit_id: z.string(),
  subreddit: z.string(),
  title: z.string(),
  score: z.number(),
  summary_snippet: z.string().nullable(),
  rank: z.number(),
  sentiment: z.string().nullable(),
  digest_id: z.string().nullable(),
  digest_date: z.coerce.date().nullable(),
});

export type RawSearchRow = z.infer<typeof RawSearchRowSchema>;

/** Validates rows returned by $queryRaw for ts_headline snippets. */
export const RawHighlightRowSchema = z.object({
  post_id: z.string(),
  headline: z.string(),
});

export type RawHighlightRow = z.infer<typeof RawHighlightRowSchema>;
