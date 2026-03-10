import { task, logger } from "@trigger.dev/sdk/v3";
import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import { sendDigestEmail, type DigestDeliveryData } from "@redgest/email";
import { sendDigestSlack } from "@redgest/slack";

export const deliverDigest = task({
  id: "deliver-digest",
  retry: { maxAttempts: 3 },
  run: async (payload: { digestId: string }) => {
    const config = loadConfig();

    // Load digest with related data
    const digest = await prisma.digest.findUniqueOrThrow({
      where: { id: payload.digestId },
      include: {
        digestPosts: {
          orderBy: { rank: "asc" },
          include: {
            post: {
              include: {
                summaries: { take: 1, orderBy: { createdAt: "desc" } },
              },
            },
          },
        },
      },
    });

    // Build delivery data grouped by subreddit
    const subredditMap = new Map<
      string,
      DigestDeliveryData["subreddits"][number]
    >();

    for (const dp of digest.digestPosts) {
      const summary = dp.post.summaries[0];
      if (!summary) continue;

      let sub = subredditMap.get(dp.subreddit);
      if (!sub) {
        sub = { name: dp.subreddit, posts: [] };
        subredditMap.set(dp.subreddit, sub);
      }

      sub.posts.push({
        title: dp.post.title,
        permalink: dp.post.permalink,
        score: dp.post.score,
        summary: summary.summary,
        keyTakeaways: summary.keyTakeaways as string[],
        insightNotes: summary.insightNotes,
        commentHighlights: summary.commentHighlights as Array<{
          author: string;
          insight: string;
          score: number;
        }>,
      });
    }

    const deliveryData: DigestDeliveryData = {
      digestId: digest.id,
      createdAt: digest.createdAt,
      subreddits: Array.from(subredditMap.values()),
    };

    // Dispatch to configured channels
    const channels: Array<{
      name: string;
      send: () => Promise<unknown>;
    }> = [];

    if (config.RESEND_API_KEY && config.DELIVERY_EMAIL) {
      const { DELIVERY_EMAIL, RESEND_API_KEY } = config;
      channels.push({
        name: "email",
        send: () =>
          sendDigestEmail(deliveryData, DELIVERY_EMAIL, RESEND_API_KEY),
      });
    }

    if (config.SLACK_WEBHOOK_URL) {
      const webhookUrl = config.SLACK_WEBHOOK_URL;
      channels.push({
        name: "slack",
        send: () => sendDigestSlack(deliveryData, webhookUrl),
      });
    }

    if (channels.length === 0) {
      logger.info("No delivery channels configured, skipping");
      return { delivered: [] };
    }

    const results = await Promise.allSettled(
      channels.map((ch) => ch.send()),
    );

    const delivered: string[] = [];
    for (const [i, r] of results.entries()) {
      const channel = channels[i];
      if (!channel) continue;
      if (r.status === "fulfilled") {
        delivered.push(channel.name);
      } else {
        logger.error(`Delivery failed for ${channel.name}`, {
          error: String(r.reason),
        });
      }
    }

    logger.info("Delivery complete", { delivered });
    return { delivered };
  },
});
