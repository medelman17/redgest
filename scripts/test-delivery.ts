import { config } from "dotenv";
config({ override: true });
import { prisma } from "@redgest/db";
import { sendDigestEmail, buildDeliveryData } from "@redgest/email";
import { sendDigestSlack } from "@redgest/slack";

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

// Send email
try {
  const emailResult = await sendDigestEmail(
    data,
    process.env.DELIVERY_EMAIL!,
    process.env.RESEND_API_KEY!,
  );
  console.log("Email sent:", JSON.stringify(emailResult));
} catch (e) {
  console.error("Email failed:", e instanceof Error ? e.message : e);
}

// Send Slack
try {
  const slackResult = await sendDigestSlack(
    data,
    process.env.SLACK_WEBHOOK_URL!,
  );
  console.log("Slack sent:", JSON.stringify(slackResult));
} catch (e) {
  console.error("Slack failed:", e instanceof Error ? e.message : e);
}

await prisma.$disconnect();
