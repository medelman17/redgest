import type { DigestDeliveryData } from "@redgest/email";

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text: string }>;
}

export function formatDigestBlocks(digest: DigestDeliveryData): SlackBlock[] {
  const dateStr = digest.createdAt.toISOString().split("T")[0] ?? "";
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Reddit Digest — ${dateStr}`,
        emoji: true,
      },
    },
  ];

  for (const sub of digest.subreddits) {
    if (sub.posts.length === 0) continue;

    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*r/${sub.name}*` },
    });

    for (const post of sub.posts) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<https://reddit.com${post.permalink}|${post.title}>* (${post.score} pts)\n${post.summary}`,
        },
      });

      if (post.keyTakeaways.length > 0) {
        const takeaways = post.keyTakeaways.map((t) => `\u2022 ${t}`).join("\n");
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*Key Takeaways:*\n${takeaways}` },
        });
      }
    }
  }

  return blocks;
}
