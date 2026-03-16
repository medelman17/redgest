import type { PrismaClient } from "@redgest/db";
import type { SubredditPipelineResult, AssembleStepResult } from "./types";

export async function assembleStep(
  jobId: string,
  subredditResults: SubredditPipelineResult[],
  db: PrismaClient,
): Promise<AssembleStepResult> {
  const markdown = renderDigestMarkdown(subredditResults);

  // Count total posts across all subreddits
  const postCount = subredditResults.reduce(
    (sum, r) => sum + r.posts.length,
    0,
  );

  // Create digest record
  const digest = await db.digest.create({
    data: {
      jobId,
      contentMarkdown: markdown,
      contentHtml: null,
    },
  });

  // Create DigestPost join records with rank ordering
  const digestPostData: Array<{
    digestId: string;
    postId: string;
    subreddit: string;
    rank: number;
  }> = [];
  let globalRank = 0;
  for (const subResult of subredditResults) {
    for (const post of subResult.posts) {
      globalRank++;
      digestPostData.push({
        digestId: digest.id,
        postId: post.postId,
        subreddit: subResult.subreddit,
        rank: globalRank,
      });
    }
  }
  if (digestPostData.length > 0) {
    await db.digestPost.createMany({ data: digestPostData });
  }

  return {
    digestId: digest.id,
    contentMarkdown: markdown,
    postCount,
  };
}

export function renderDigestMarkdown(
  subredditResults: SubredditPipelineResult[],
  date?: string,
): string {
  const digestDate = date ?? new Date().toISOString().split("T")[0];
  const sections: string[] = [`# Reddit Digest — ${digestDate}\n`];

  for (const sub of subredditResults) {
    if (sub.posts.length === 0) continue;

    sections.push(`## r/${sub.subreddit}\n`);

    for (const post of sub.posts) {
      const s = post.summary;

      sections.push(`### ${post.title}`);
      sections.push(
        `**Sentiment:** ${s.sentiment} | **Relevance:** ${s.relevanceScore}/10\n`,
      );
      sections.push(s.summary);

      if (s.keyTakeaways.length > 0) {
        sections.push("\n**Key Takeaways:**");
        for (const t of s.keyTakeaways) {
          sections.push(`- ${t}`);
        }
      }

      if (s.insightNotes) {
        sections.push(`\n**Interest Notes:** ${s.insightNotes}`);
      }

      if (s.communityConsensus) {
        sections.push(`\n**Community Consensus:** ${s.communityConsensus}`);
      }

      if (s.commentHighlights.length > 0) {
        sections.push("\n**Community Highlights:**");
        for (const h of s.commentHighlights) {
          sections.push(`> ${h.insight} — u/${h.author} (${h.score})`);
        }
      }

      if (s.notableLinks.length > 0) {
        sections.push("\n**Notable Links:**");
        for (const link of s.notableLinks) {
          sections.push(`- ${link}`);
        }
      }

      sections.push("\n---\n");
    }
  }

  return sections.join("\n");
}
