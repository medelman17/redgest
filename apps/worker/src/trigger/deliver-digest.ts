import { task, logger } from "@trigger.dev/sdk/v3";
import { loadConfig } from "@redgest/config";
import {
  recordDeliveryPending,
  recordDeliveryResult,
  type DeliveryClient,
  type DeliveryTransactionClient,
} from "@redgest/core";
import { prisma } from "@redgest/db";
import { sendDigestEmail, buildDeliveryData, buildFormattedDigest } from "@redgest/email";
import { sendDigestSlack } from "@redgest/slack";
import { generateDeliveryProse } from "@redgest/llm";
import type { DeliveryDigestInput } from "@redgest/llm";

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

    const deliveryData = buildDeliveryData(digest);

    // Map to LLM input (drop fields the LLM doesn't need)
    const llmInput: DeliveryDigestInput = {
      subreddits: deliveryData.subreddits.map((s) => ({
        name: s.name,
        posts: s.posts.map((p) => ({
          title: p.title,
          score: p.score,
          summary: p.summary,
          keyTakeaways: p.keyTakeaways,
          insightNotes: p.insightNotes,
          commentHighlights: p.commentHighlights,
        })),
      })),
    };

    // Dispatch to configured channels
    const channels: Array<{
      name: string;
      type: "EMAIL" | "SLACK";
      send: () => Promise<unknown>;
    }> = [];

    if (config.RESEND_API_KEY && config.DELIVERY_EMAIL) {
      const { DELIVERY_EMAIL, RESEND_API_KEY } = config;
      channels.push({
        name: "email",
        type: "EMAIL",
        send: async () => {
          const { data: prose } = await generateDeliveryProse(llmInput, "email");
          const formatted = buildFormattedDigest(deliveryData, prose);
          return sendDigestEmail(formatted, DELIVERY_EMAIL, RESEND_API_KEY);
        },
      });
    }

    if (config.SLACK_WEBHOOK_URL) {
      const webhookUrl = config.SLACK_WEBHOOK_URL;
      channels.push({
        name: "slack",
        type: "SLACK",
        send: async () => {
          const { data: prose } = await generateDeliveryProse(llmInput, "slack");
          const formatted = buildFormattedDigest(deliveryData, prose);
          return sendDigestSlack(formatted, webhookUrl);
        },
      });
    }

    if (channels.length === 0) {
      logger.info("No delivery channels configured, skipping");
      return { delivered: [] };
    }

    // Record pending delivery rows before dispatching
    // PrismaClient satisfies DeliveryClient at runtime; Prisma's generated types are stricter
    await recordDeliveryPending(
      prisma as unknown as DeliveryClient,
      payload.digestId,
      digest.jobId,
      channels.map((ch) => ch.type),
    );

    const results = await Promise.allSettled(
      channels.map((ch) => ch.send()),
    );

    const delivered: string[] = [];
    for (const [i, r] of results.entries()) {
      const ch = channels[i];
      if (!ch) continue;

      if (r.status === "fulfilled") {
        delivered.push(ch.name);
        const externalId =
          r.value && typeof r.value === "object" && "id" in r.value
            ? String(r.value.id)
            : undefined;
        // PrismaClient satisfies DeliveryTransactionClient at runtime
        await recordDeliveryResult(
          prisma as unknown as DeliveryTransactionClient,
          payload.digestId,
          digest.jobId,
          ch.type,
          { ok: true, externalId },
        );
      } else {
        const errorMsg =
          r.reason instanceof Error ? r.reason.message : String(r.reason);
        logger.error(`Delivery to ${ch.name} failed: ${errorMsg}`);
        // PrismaClient satisfies DeliveryTransactionClient at runtime
        await recordDeliveryResult(
          prisma as unknown as DeliveryTransactionClient,
          payload.digestId,
          digest.jobId,
          ch.type,
          { ok: false, error: errorMsg },
        );
      }
    }

    // If all channels failed, throw so Trigger.dev retries (retry: 3)
    if (delivered.length === 0 && channels.length > 0) {
      const failures = results
        .filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        )
        .map((r) => String(r.reason));
      throw new Error(
        `All delivery channels failed: ${failures.join("; ")}`,
      );
    }

    logger.info("Delivery complete", { delivered });
    return { delivered };
  },
});
