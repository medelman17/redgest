import type { FormattedDigest } from "@redgest/email";

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text: string }>;
}

export function formatDigestBlocks(digest: FormattedDigest): SlackBlock[] {
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
    {
      type: "section",
      text: { type: "mrkdwn", text: digest.headline },
    },
  ];

  for (const section of digest.sections) {
    if (section.posts.length === 0) continue;

    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*r/${section.subreddit}*` },
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: section.body },
    });

    if (section.posts.length > 0) {
      const links = section.posts
        .map(
          (p) =>
            `<https://reddit.com${p.permalink}|${p.title}> (${p.score} pts)`,
        )
        .join("  ·  ");
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: links }],
      });
    }
  }

  return blocks;
}
