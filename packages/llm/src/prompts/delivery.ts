export type DeliveryChannel = "email" | "slack";

export interface DeliveryDigestInput {
  subreddits: Array<{
    name: string;
    posts: Array<{
      title: string;
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

const EMAIL_SYSTEM = `You are writing a brief newsletter-style digest of curated Reddit posts for a personal subscriber.

Structure your output as JSON with:
1. "headline" — A 2-3 sentence overview highlighting the most noteworthy findings across all subreddits. Write it as engaging prose that makes the reader want to keep reading.
2. "sections" — One entry per subreddit. Each section's "body" is a 2-4 sentence paragraph covering that subreddit's posts. Mention post titles naturally within the prose. Highlight key findings, notable community reactions, and why they matter.

Guidelines:
- Write natural flowing prose. No bullet points, numbered lists, or section headers within the text.
- Reference post titles when discussing specific findings so the reader knows which post is being discussed.
- Be concise but substantive — every sentence should earn its place.
- The reader is a developer — use appropriate technical vocabulary without over-explaining.`;

const SLACK_SYSTEM = `You are writing an ultra-concise Reddit digest for Slack. Be brief, punchy, and direct.

Structure your output as JSON with:
1. "headline" — 1-2 sentences. The single most notable finding or trend across all subreddits.
2. "sections" — One entry per subreddit. Each section's "body" is 1-2 sentences max — just the most important takeaway.

Guidelines:
- Extremely concise. Every word must earn its place.
- No bullet points or formatting within the text. Plain prose only.
- Total output should be scannable in under 30 seconds.
- Mention post titles only when essential for context.`;

export function buildDeliverySystemPrompt(channel: DeliveryChannel): string {
  return channel === "email" ? EMAIL_SYSTEM : SLACK_SYSTEM;
}

export function buildDeliveryUserPrompt(input: DeliveryDigestInput): string {
  const parts: string[] = ["Here are the curated posts grouped by subreddit:\n"];

  for (const sub of input.subreddits) {
    parts.push(`## r/${sub.name}`);

    for (const post of sub.posts) {
      parts.push(`### ${post.title} (${post.score} pts)`);
      parts.push(post.summary);

      if (post.keyTakeaways.length > 0) {
        parts.push("Key takeaways:");
        for (const t of post.keyTakeaways) {
          parts.push(`- ${t}`);
        }
      }

      if (post.insightNotes) {
        parts.push(`Relevance: ${post.insightNotes}`);
      }

      if (post.commentHighlights.length > 0) {
        parts.push("Notable comments:");
        for (const c of post.commentHighlights) {
          parts.push(`- u/${c.author} (${c.score} pts): ${c.insight}`);
        }
      }

      parts.push("");
    }
  }

  return parts.join("\n");
}
