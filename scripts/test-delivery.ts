import { config } from "dotenv";
config({ override: true });
import { prisma } from "@redgest/db";
import { sendDigestEmail, buildDeliveryData, buildFormattedDigest } from "@redgest/email";
import { sendDigestSlack } from "@redgest/slack";
import { generateDeliveryProse } from "@redgest/llm";

const digestId = process.argv[2];
if (!digestId) {
  console.error("Usage: tsx scripts/test-delivery.ts <digestId>");
  process.exit(1);
}

const digest = await prisma.digest.findUniqueOrThrow({
  where: { id: digestId },
  include: {
    digestPosts: {
      orderBy: { rank: "asc" },
      include: {
        post: {
          include: { summaries: { take: 1, orderBy: { createdAt: "desc" } } },
        },
      },
    },
  },
});

const data = buildDeliveryData(digest);

// Map to LLM input
const llmInput = {
  subreddits: data.subreddits.map((s) => ({
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

// Send email
try {
  const { data: emailProse } = await generateDeliveryProse(llmInput, "email");
  const emailFormatted = buildFormattedDigest(data, emailProse);
  const emailResult = await sendDigestEmail(
    emailFormatted,
    process.env.DELIVERY_EMAIL!,
    process.env.RESEND_API_KEY!,
  );
  console.log("Email sent:", JSON.stringify(emailResult));
} catch (e) {
  console.error("Email failed:", e instanceof Error ? e.message : e);
}

// Send Slack
try {
  const { data: slackProse } = await generateDeliveryProse(llmInput, "slack");
  const slackFormatted = buildFormattedDigest(data, slackProse);
  const slackResult = await sendDigestSlack(
    slackFormatted,
    process.env.SLACK_WEBHOOK_URL!,
  );
  console.log("Slack sent:", JSON.stringify(slackResult));
} catch (e) {
  console.error("Slack failed:", e instanceof Error ? e.message : e);
}

await prisma.$disconnect();
